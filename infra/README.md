# Frejsi infrastructure

Everything Frejsi runs on lives in one Azure resource group, described in Bicep here and applied
only by the release pipeline (`.github/workflows/release.yml`, job `infra`). Nobody runs `az` from a
session; a change to infra is a PR whose Bicep diff is the review, and the owner's one tap on the
`production-infra` environment is the approval (`docs/agent-workflow.md` sections 6 and 9).

```
infra/
  main.bicep          the module list (append-only: a lane adds a module at the end, never reorders)
  main.bicepparam     parameters; per-installation values come from repository variables, not the file
  modules/            one file per concern: monitoring, keyvault, sql, webpubsub, functionapp, roles,
                      staticwebapp, alerts, photos-storage; functionapp/appsettings.bicep merges the Function App's
                      settings into the live ones instead of replacing them
  deploy.sh           what the `deploy` job runs after infra: secrets once, migrations, poller, web
  test/               node:test suite over the built ARM JSON and over deploy.sh against fake tools
```

## Resources and cost

| Resource | Tier | Purpose | DKK / month |
|---|---|---|---|
| Static Web App | Standard | hybrid Next.js (UI + API routes), custom domain, preview environments | ~62 |
| Function App | Linux Consumption (Y1), Node 22 | the poller, every 5 minutes; well inside the free grant | ~0 |
| Storage account | Standard LRS | the Function App's own storage (not photos) | <1 |
| Azure SQL | Basic, 5 DTU, 2 GB | all data; always on, so the poller never has to wake it | ~34 |
| Web PubSub | Free (F1) | live push, hub `frejsi`, 20 connections, 20k messages/day | 0 |
| Key Vault | Standard, RBAC | `database-url`, `web-pubsub-connection-string`, `bootstrap-token`, `glucose-<spaceId>` | <1 |
| Log Analytics + Application Insights | Pay-as-you-go, 1 GB/day cap, 30 days | telemetry and the one alert | 0 (under 5 GB free) |
| Action group + scheduled query alert | — | "no reading for 35 minutes" to `ALERT_EMAIL` | 0 |
| Photo storage account | Standard LRS | private originals + thumbnails, seven-day soft delete | ~1–3 |
| **Total** | | | **~98–100** |

Prices are West Europe list prices in October 2026 at about 6.9 DKK per USD; check the invoice after
the first month. The spec's target (section 1) is 50–80 DKK/month. The Standard Static Web App is the
lever: it is what the spec asks for, and it is also two thirds of the bill. On the Free plan (custom
domain still included; no SLA, no managed backend scaling) the total is about 35 DKK/month. That is
the owner's call; `modules/staticwebapp.bicep` changes one word.

With the repository variable `SQL_SERVER_ID` set, the database sits on an existing server outside the
group instead (same tier, same price, no server of its own); see "An existing SQL server" below.

Photo storage uses a **dedicated Standard LRS account**, about **1–3 DKK/month** at family scale
(v0.2.0 plan, decision 21), bringing the estimate to about 98–100 DKK/month. The private `photos`
container holds originals up to 1600 px and 320×320 JPEG thumbnails, re-encoded on the server
without EXIF, GPS, XMP or ICC metadata. Public blob access is disabled, HTTPS/TLS 1.2 is required,
and deleted blobs are retained for seven days. It never shares the Function App's account.

`main.bicep` includes `photos-storage.bicep` and exposes the account name as a non-secret output.
`deploy.sh` discovers it by the `purpose=photos` tag (or accepts `PHOTOS_STORAGE_ACCOUNT` explicitly),
creates Key Vault's `blob-connection-string` only when absent, then copies the secret to SWA's
`BLOB_CONNECTION_STRING` setting. Later releases reuse the secret without querying account keys.
Connection strings travel through mode-600 files and are never printed or passed on a command line.
Failed or empty reads abort before replacing SWA settings. Without either a photo account or a stored
secret the setting is omitted; services can answer `503 photo-unavailable` while the rest works.

Server consumers import the `PhotoStore` contract, `processPhoto` and the store factory from
`@frejsi/shared/photos`; the root shared export deliberately excludes photos so the poller avoids
native image processing. Browser `downscale` prepares JPEG bytes locally; the server always decodes
and re-encodes again. `sharp` is externalized and its native packages traced into the Next standalone
build. Task 10's release build check must still exercise processing inside the deployed artifact.

Local development uses Azurite with the same Blob adapter and an explicit `BlobEndpoint` in the
connection string. Tests use `MemoryPhotoStore` or a fake HTTP transport, with no Azure calls.
Never log an account key, connection string, signed photo URL or uploaded image.

## How secrets work

No secret is ever in this repository, in a parameter file, in a log or on a command line.

| Secret | Created by | Lives in | Read by |
|---|---|---|---|
| SQL application user password (a contained database user) | `deploy.sh`, once, as the deploy principal (the dedicated server's Entra admin, or `db_owner` in the database on an existing server) | Key Vault `database-url` | Function App (Key Vault reference), web app (app setting written by `deploy.sh`) |
| Web PubSub connection string | `deploy.sh`, once, from the resource's keys | Key Vault `web-pubsub-connection-string` | web app (app setting) |
| `bootstrap-token` | Bicep, `newGuid()` parameter default; rotates on every infra deploy | Key Vault | web app (app setting); the owner reads it once (step 9) |
| `glucose-<spaceId>` (Dexcom credential) | the Function App's `source-connect` trigger from Settings | Key Vault | the poller, through its managed identity |
| Function App storage key, App Insights connection string | Azure | app settings | the Function App (the Functions host on a Consumption plan needs a key-based `AzureWebJobsStorage`; the key never leaves Azure) |

Why the deploy principal is the SQL server's Entra admin: Prisma cannot authenticate with Entra
tokens, so the application needs a SQL user with a password; Bicep must never hold a password; so
the user is created by `deploy.sh` through `sqlcmd` with the pipeline's own identity, and the password
it generates goes straight into Key Vault. It is a contained user (`CREATE USER ... WITH PASSWORD`
in the database, no login in `master`), so the deploy principal needs `db_owner` in that one
database and nothing server-wide. Bicep creates the server Entra-only (which lets the SQL admin be
omitted) and then turns SQL authentication on with the `azureADOnlyAuthentications/Default` child
resource.

The Function App's managed identity holds Key Vault Secrets Officer (it writes `glucose-<spaceId>`)
and Web PubSub Service Owner (it publishes without a key). The deploy principal holds Key Vault
Secrets Officer. Static Web Apps gives hybrid Next.js no usable managed identity, so the web app's
settings are written by `deploy.sh` from Key Vault on every release (plan decision 10).

## What the owner does once

In this order. Everything after step 5 is one tap or one DNS record.

1. **Resource group.** `frejsi` in West Europe, in the Proxus subscription. Nothing else goes in it:
   `deploy.sh` finds resources by type and expects exactly one of each.
2. **App registration.** In Entra ID create an app registration (for example `frejsi-deploy`). No
   client secret is needed, ever. Note its application (client) ID, the tenant ID and the
   subscription ID.
3. **Federated credentials** on that app registration, issuer `https://token.actions.githubusercontent.com`,
   audience `api://AzureADTokenExchange`, one per environment: `production-infra`, `production`
   and, only if you want PR previews, `preview` (then also set the repository variable
   `PREVIEWS_ENABLED` to `true`, which turns on the cleanup job that runs when any PR closes; without
   it that job is skipped, since no preview can exist). The subject is `<prefix>:environment:<name>`,
   where `<prefix>` is what GitHub presents for this repository:

   ```
   gh api repos/<owner>/<repo>/actions/oidc/customization/sub --jq .sub_claim_prefix
   ```

   Newer repositories use immutable subjects with the owner and repository IDs, so for this
   repository the subjects are:
   - `repo:nicklasjepsen@2478876/frejsi@1419802630:environment:production-infra`
   - `repo:nicklasjepsen@2478876/frejsi@1419802630:environment:production`
   - `repo:nicklasjepsen@2478876/frejsi@1419802630:environment:preview` (only with previews on;
     previews are off here for now, so this one does not exist yet)

   If the command prints nothing, the repository uses the older form `repo:<owner>/<repo>`. A wrong
   subject fails the login with `AADSTS700213: No matching federated identity record found`.
4. **Role assignments** for the app registration's service principal on the resource group:
   **Owner**, or Contributor plus User Access Administrator (the deployment creates role assignments
   for the Function App's identity and for the deploy principal itself). Key Vault data-plane access is
   granted by Bicep, not by hand. Also one read-only grant at **subscription** scope: a custom role
   with the action `Microsoft.Web/locations/*/read`. ARM polls asynchronous Static Web Apps
   operations (the custom domain) at
   `/subscriptions/<id>/providers/Microsoft.Web/locations/<region>/staticSitesOperationStatuses/…`,
   outside the resource group; without the grant the infra job hangs with `AuthorizationFailed` until
   it times out (the exact action is not a registered operation, so only the wildcard can grant it).
5. **Repository variables** (Settings → Secrets and variables → Actions → Variables):
   `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, and `SQL_SERVER_ID` only for an
   existing SQL server (below). Leave `CUSTOM_DOMAIN` unset until step 7. **Repository secret**
   `ALERT_EMAIL` (where the 35-minute alert goes): a secret and not a variable, because the run logs of
   a public repository are public and variables are printed in them unmasked. The environments
   `production-infra` (owner as required reviewer) and `production` exist already; `preview` is
   created on first use of `preview.yml` if you want previews. The repository secret
   `CI_SQL_SA_PASSWORD` (the full suite's SQL Server container) already exists;
   `ANTHROPIC_API_KEY_EVALS` is not needed before v0.4.0.
6. **First release.** When the milestone is tagged, `release.yml` stops at the `infra` job for your
   approval: one tap. The deployment takes about ten minutes (the SQL server is the slow one). If the
   `bootstrap-token` secret fails with a 403 on the very first run, that is role propagation; the job
   retries once after a minute. The `deploy` job then creates the database user, the Key Vault secrets,
   runs the migrations and deploys the poller and the web app. The smoke step reads
   `https://<default hostname>/api/health`.
7. **DNS for the custom domain.** From the Static Web App's overview copy the default hostname
   (`xxxx.azurestaticapps.net`) and create a CNAME `frejsi.jepsen.ninja → <default hostname>` at the
   DNS provider. If the provider cannot CNAME (apex domains), use the TXT record the portal's
   "Custom domains" page shows instead. Then set the repository variable `CUSTOM_DOMAIN` to
   `frejsi.jepsen.ninja` and redeploy the same tag with `workflow_dispatch` on `release.yml`, with
   the **infra** box ticked (a changed variable is invisible to the file diff that otherwise decides
   whether the infra job runs): the infra job adds the domain (CNAME validation needs the record to
   exist first, which is why the domain is conditional on the variable) and `deploy.sh` sets
   `APP_ORIGIN` to it. The certificate is issued and renewed by Static Web Apps.
8. **Key Vault read access for yourself.** Give your own user Key Vault Secrets User on the vault
   (`kv-frejsi-<suffix>`), or use the portal's Secrets page, for the next step.
9. **Read `bootstrap-token` once** and bootstrap the first space (`docs/operations.md`, task 10):
   `az keyvault secret show --vault-name kv-frejsi-<suffix> -n bootstrap-token --query value -o tsv`.
   The route is dead once a space exists; the token rotates on every infra deploy and nobody needs it
   again.

Then the subject's Dexcom Share credential is entered in Settings on the site (issue for task 12),
never anywhere else.

## An existing SQL server

Use this when Azure will not create a SQL server in the resource group's region for your
subscription (`az sql db list-editions` or the first release answers "Provisioning is restricted in
this region"), or when you already pay for a server. Static Web Apps offers few regions, so moving
the whole group is often not an option. Frejsi's production database works this way: Azure SQL is
restricted in West Europe on its subscription.

With `SQL_SERVER_ID` set, Bicep creates no SQL server and never touches the existing one; the
database, its tier and the server's settings are yours. The deploy principal gets exactly two things
on that server: `db_owner` in the Frejsi database (to create the application's contained user and run
migrations), and a custom role that lets it open and close its own temporary firewall rule. It is
not the server's Entra admin and has no rights over the other databases on it. Do this once, before
the first release, as the server's Entra admin; the role names below are examples:

1. The server must allow SQL authentication (`az sql server ad-only-auth get` answers `false`) and
   "Allow Azure services" (a firewall rule `AllowAllWindowsAzureIps`, 0.0.0.0–0.0.0.0): the Function
   App and the Static Web App have no fixed address.
2. Create the database, Basic 5 DTU like the dedicated layout:
   `az sql db create -g <server rg> -s <server> -n frejsi --edition Basic --capacity 5 --max-size 2GB --backup-storage-redundancy Local --zone-redundant false --tags project=frejsi`
3. In that database, connected as the Entra admin (Azure Data Studio, the portal's query editor, or
   `sqlcmd -G`), create the deploy principal's user under the app registration's display name:
   `CREATE USER [frejsi-deploy] FROM EXTERNAL PROVIDER; ALTER ROLE db_owner ADD MEMBER [frejsi-deploy];`
4. A custom role with `Microsoft.Sql/servers/read` and `Microsoft.Sql/servers/firewallRules/read`,
   `/write` and `/delete` (assignable scope: the server's resource group), assigned to the deploy
   principal on the server only:
   `az role assignment create --assignee-object-id <service principal object id> --assignee-principal-type ServicePrincipal --role "<custom role name>" --scope <server resource id>`
5. Set the repository variable `SQL_SERVER_ID` to the server's resource ID
   (`/subscriptions/.../resourceGroups/.../providers/Microsoft.Sql/servers/<server>`). The server may be
   in another resource group or subscription; `deploy.sh` reads both from the ID.

The database must be named `frejsi` (or set `SQL_DATABASE` in the deploy job). Cross-region queries
cost latency: with the web app in West Europe and the server in Sweden Central, every query adds about
20–30 ms.

## Deploy your own in 15 minutes

Frejsi is one person's data on one person's subscription. A fork gets its own copy like this:

1. Fork the repository. In your fork, keep `baseName` as it is or set it in `main.bicepparam`
   (at most 7 characters; names stay globally unique through a suffix derived from the resource
   group id).
2. Do steps 1–5 above in your own Azure subscription and GitHub repository. Build the federated
   credential subjects from your fork's own prefix, read with the command in step 3
   (`<prefix>:environment:production-infra`, `…:production`, and `…:preview` only if you want PR
   previews); a fork created today gets an immutable prefix with its own IDs, so never copy this
   repository's subjects. Create the environments `production-infra` and `production` in the fork
   (Settings → Environments), with yourself as required reviewer on `production-infra`; for previews
   also `preview` and the repository variable `PREVIEWS_ENABLED=true`. Add the repository secret
   `CI_SQL_SA_PASSWORD` (any strong password; it is only for the SQL Server container the release
   suite starts).
3. Create a milestone titled `v0.1.0` with no open issues and push the tag `v0.1.0`. Approve the
   infra job when it asks. The site is at the Static Web App's default hostname.
4. Optional: your own domain, as in step 7. Not optional: the repository secret `ALERT_EMAIL` must
   be set; it is your address, not ours. If Azure refuses to create the SQL server in your region,
   see "An existing SQL server".

Nothing Danish is hard-coded: the UI ships in `da` and `en`, and the glucose and food sources are
plugins. Docker Compose for non-Azure hosting is planned for a later version (spec section 9).

## What `deploy.sh` does, in order

1. Fails on the first missing variable (`AZURE_SUBSCRIPTION_ID`, `AZURE_RESOURCE_GROUP`,
   `APP_VERSION`) before touching Azure, and checks the tools it needs are present.
2. Finds the Key Vault, SQL server, Web PubSub, Function App, Static Web App and Application
   Insights by type in the resource group; with `SQL_SERVER_ID` set, the SQL server is that one
   (its subscription and resource group come from the ID, for the hostname and the firewall rule).
3. If `database-url` is absent in Key Vault: generates a 40-character password, creates the
   application's contained database user with `db_owner` in the database
   (`sqlcmd --authentication-method ActiveDirectoryDefault`, SQL from a mode-600 file, never argv;
   nothing in `master`), and stores the Prisma URL. If `web-pubsub-connection-string` is absent:
   reads the primary connection string and stores it. Neither is ever rotated by a deploy; rotate by
   deleting the secret and releasing (and, for SQL, `ALTER USER` runs because the user exists).
4. Opens a SQL firewall rule for the runner's IP, runs `prisma migrate deploy`, and removes the rule
   on exit even if something failed (a `trap`).
5. Poller: sets `SCM_DO_BUILD_DURING_DEPLOYMENT=false`, `ENABLE_ORYX_BUILD=false` and
   `APP_VERSION`, zips `poller/dist` and deploys it; on Linux Consumption the zip deploy stores the
   package in the storage account and sets `WEBSITE_RUN_FROM_PACKAGE` to it, which the script
   verifies. Waits for the `source-connect` function key.
6. Static Web App settings (plan section 7): `DATABASE_URL`, `BOOTSTRAP_TOKEN`,
   `WEB_PUBSUB_CONNECTION_STRING`, `WEB_PUBSUB_HUB`, `SOURCE_CONNECT_URL`, `SOURCE_CONNECT_KEY`,
   `APPLICATIONINSIGHTS_CONNECTION_STRING`, `APP_ORIGIN`, `NEXT_PUBLIC_APP_VERSION`, written as one
   JSON body from a mode-600 file through `az rest`. The script owns these settings: anything set by
   hand in the portal is replaced on the next release.
7. Uploads the web build with the Static Web Apps deployment client (the container the
   `Azure/static-web-apps-deploy` action wraps; the SWA CLI does not support hybrid Next.js), with
   `skipAppBuild`, because the release job has already built `web/.next/standalone`. The deployment
   token reaches the container through a mode-600 env file, not docker's command line. The web
   build script must copy `.next/static` and `public` into `.next/standalone`, as the Static Web
   Apps docs for hybrid Next.js require.

Every value the script reads from Azure is captured with a plain assignment and checked for empty,
so a throttled or failing `az` call stops the release instead of storing an empty secret or writing
an empty app setting (the tests cover both).

A Bicep redeploy keeps the Function App settings `deploy.sh` wrote (`WEBSITE_RUN_FROM_PACKAGE`,
`APP_VERSION`, `ENABLE_ORYX_BUILD`): `modules/functionapp/appsettings.bicep` reads the live settings
with `list()` and merges Bicep's own into them, so the poller keeps running from its package while
the deploy job is still on its way. `deploy.sh` sets the deploy-time ones again anyway; the release
order stays infra, then deploy.

## Checking locally

No Azure is needed. Install the Bicep CLI
(`curl -fsSL -o ~/.local/bin/bicep https://github.com/Azure/bicep/releases/download/v0.48.1/bicep-linux-x64 && chmod +x ~/.local/bin/bicep`),
`shellcheck`, and run:

```
bicep build infra/main.bicep --stdout > /dev/null
bicep lint infra/main.bicep
ALERT_EMAIL=you@example.invalid bicep build-params infra/main.bicepparam --stdout > /dev/null
shellcheck -S style infra/deploy.sh
node --test 'infra/test/*.test.mjs'
```

`infra-check.yml` runs the same on every PR that touches `infra/**`. It is not a required check.

## Known limits

- Linux Consumption (Y1) is what the plan chose; Microsoft retires it on 30 September 2028. Moving
  to Flex Consumption is a one-module change when the time comes.
- The alert needs the poller to emit the `reading.stored` custom event (task 4). Until it does, the
  alert fires after the first 35 minutes of production. That is correct: nothing is being stored.
- Previews (`preview.yml`) carry no database; screens that need data show their empty states.

## Live groups and the connect handler

A client token from `negotiate` carries the user id and nothing else: no groups, no roles. The hub
`frejsi` has one event handler, for the system `connect` event only, at
`https://<static web app default hostname>/api/pubsub`, registered by `deploy.sh` step 7. Every time a
socket connects, Web PubSub calls it; the app reads the member's current role in the space named by
the socket URL's `spaceId` and answers with `space-<id>`, plus `space-<id>-glucose` for owners and
carers only. A viewer, a carer downgraded a second ago or a removed member is never joined to the
glucose group, whatever token they hold (issue #95). Any failure (a bad signature, an unknown member,
the database down) is a non-2xx answer, and Web PubSub then refuses the socket; the client polls.

**Handler authentication: the hub's own access key, not a managed identity.**

- *Abuse protection:* the app answers the CloudEvents `OPTIONS` handshake with
  `WebHook-Allowed-Origin` only for its own Web PubSub host, and checks `WebHook-Request-Origin` on
  every request.
- *Shared key:* Web PubSub signs every upstream request: `ce-signature` holds
  `sha256=HMAC_SHA256(accessKey, connectionId)` for its primary and secondary key. The app checks it
  with the `AccessKey` in `WEB_PUBSUB_CONNECTION_STRING`, which `deploy.sh` already copies from Key
  Vault (`web-pubsub-connection-string`). Nothing new to store or rotate.
- *Why not a managed identity:* the handler's `ManagedIdentity` auth makes the service send an Entra
  token whose audience is an app registration. That needs a second app registration the pipeline
  cannot create with its role, and code in the web app to validate Entra tokens; Static Web Apps
  gives hybrid Next.js no built-in check for it. The signature gives the same assurance (only the
  holder of the hub's key can produce it) with the secret the web app already has.

Things to know:

- **Why `deploy.sh` and not Bicep.** Azure validates a handler with an `OPTIONS` request when it is
  set, and the route exists only once step 6 has uploaded the build; on the first release there is
  no web app at all. `deploy.sh` retries the registration while the build comes up and fails the
  release if it never validates.
- **Releases that change infra.** `modules/webpubsub.bicep` declares the hub without a handler, so
  the `infra` job clears it until `deploy.sh` sets it again a few minutes later. Sockets opened in
  that window join no group: nothing leaks, but those screens get no push until they reconnect
  (or the page is reloaded).
- **Key rotation.** If you regenerate the primary key in the portal, delete the Key Vault secret
  `web-pubsub-connection-string` and run a release, so `deploy.sh` stores the new one. Until then the
  app cannot verify the hub and every socket is refused (screens poll).
- **Local development.** A hub without this handler joins sockets to no group, so a socket opens
  and stays silent. Either leave `WEB_PUBSUB_CONNECTION_STRING` unset (negotiate answers 503 and the
  screens poll), or use a hub of your own whose handler is `tunnel:///api/pubsub` (connect event
  only) and run `awps-tunnel run --hub frejsi --upstream http://localhost:3000`.

## Optional AI adapters (v0.4.0)

AI stays off in production until the owner supplies settings and enables it for a space. A release
without these secrets succeeds. `deploy.sh` copies only present secrets into SWA app settings using
mode-600 files and gives the Function App Key Vault references to the same secrets. Missing secrets
produce one notice per setting, and any stale Function App references for those settings are removed;
unreadable or empty existing secrets stop the deploy. Values never
reach command lines or output. The script also raises SQL compatibility to 170 after migrations if
it is lower, for the `vector(1024)` column; higher levels are preserved.

| App setting | Optional Key Vault secret |
|---|---|
| `ANTHROPIC_API_KEY` | `anthropic-api-key` |
| `VOYAGE_API_KEY` | `voyage-api-key` |
| `AZURE_OPENAI_ENDPOINT` | `azure-openai-endpoint` |
| `AZURE_OPENAI_API_KEY` | `azure-openai-api-key` |
| `AZURE_OPENAI_DEPLOYMENT_SMALL` | `azure-openai-deployment-small` |
| `AZURE_OPENAI_DEPLOYMENT_EVERYDAY` | `azure-openai-deployment-everyday` |
| `AZURE_OPENAI_DEPLOYMENT_INSIGHT` | `azure-openai-deployment-insight` |
| `AZURE_OPENAI_DEPLOYMENT_EMBED` | `azure-openai-deployment-embed` |
| `OLLAMA_URL` | `ollama-url` |
| `OLLAMA_MODEL_SMALL` | `ollama-model-small` |
| `OLLAMA_MODEL_EVERYDAY` | `ollama-model-everyday` |
| `OLLAMA_MODEL_INSIGHT` | `ollama-model-insight` |
| `OLLAMA_MODEL_EMBED` | `ollama-model-embed` |
| `AI_CACHE_EMBED_PROVIDER` | `ai-cache-embed-provider` |

The owner creates the secrets (issue #72), using a protected UTF-8 file rather than putting a value
in shell history. For example, with a fictional vault name:

```sh
az keyvault secret set --vault-name kv-frejsi-example --name anthropic-api-key \
  --file /secure/path/anthropic-api-key --encoding utf-8 --output none
```

Do this for each setting needed by the selected provider. No adapter provisions Azure resources.
Azure OpenAI remains inert until an endpoint and everyday deployment are supplied. It uses the key
when present; otherwise `DefaultAzureCredential` supplies a token (the Function App identity needs
access to that Azure OpenAI resource; SWA needs a key). Ollama requires a URL reachable from the
server and an everyday model installed there; localhost refers to the app host, not a family device.
Small and insight deployments/models default to the configured everyday one if omitted. The
embedding defaults are `text-embedding-3-small` for Azure and `mxbai-embed-large` for Ollama. An
Ollama everyday model must support tools and vision for those calls. Unsupported requests fail as
unavailable; they never switch provider or model silently.

Anthropic uses the plan's role models: Claude Haiku 5.5 (small), Sonnet 5.5 (everyday), Fable 5.1
(insight). Structured output and strict automatic tool calling run through the SDK. Calls have
20/30/120-second deadlines by role, and all embeddings have a 10-second deadline. Adapters make
one attempt without automatic retries; the existing capped provider counts attempts and checks
outputs. Every embedding response must contain one finite, 1024-dimensional vector per input.

Anthropic embeddings use **Voyage AI**, a separate vendor that receives the family's dish names,
with `voyage-3.5` at 1024 dimensions. Without `voyage-api-key`, Anthropic advertises no embedding
capability and search retains its keyword path. The owner's stated assumption accepts Voyage;
there is no implicit alternate embedding vendor. `AI_CACHE_EMBED_PROVIDER` selects the configured
provider for shared-cache enrichment; per-space and shared-cache vectors must use the same model
to be comparable. Fable 5.1 requires the account's 30-day retention setting; issue #72 tracks the
owner's confirmation. Weekly input is statistics and family-typed meal titles, never raw readings.

The plan's informational budget at the default caps (`AI_DAILY_CAP=50`, `AI_EMBED_DAILY_CAP=500`,
`AI_EMBED_BACKFILL_DAILY_CAP=2000`) is about **$3/month per space** for a family logging ten times a
day, up to approximately **$15/month** if all 50 everyday calls are used daily. A parse uses roughly
three completions ($0.011), a photo estimate $0.007, a meal sentence $0.01, a weekly summary
$0.07/week; normalisation and embeddings add cents per month. A full live eval run is roughly $2.
These are planning estimates, not a billing guarantee; model prices and input sizes can change.
No production keys are assumed present and tests use fictional fixtures with injected transports,
or the existing `FAKE_AI_PROVIDER=1` registry.

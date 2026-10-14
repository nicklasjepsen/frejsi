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
                      staticwebapp, alerts; functionapp/appsettings.bicep merges the Function App's
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
| **Total** | | | **~97** |

Prices are West Europe list prices in October 2026 at about 6.9 DKK per USD; check the invoice after
the first month. The spec's target (section 1) is 50–80 DKK/month. The Standard Static Web App is the
lever: it is what the spec asks for, and it is also two thirds of the bill. On the Free plan (custom
domain still included; no SLA, no managed backend scaling) the total is about 35 DKK/month. That is
the owner's call; `modules/staticwebapp.bicep` changes one word.

Deferred to v0.2.0: Blob Storage for food photos (spec section 4).

## How secrets work

No secret is ever in this repository, in a parameter file, in a log or on a command line.

| Secret | Created by | Lives in | Read by |
|---|---|---|---|
| SQL application login password | `deploy.sh`, once, as the server's Entra admin (the deploy principal) | Key Vault `database-url` | Function App (Key Vault reference), web app (app setting written by `deploy.sh`) |
| Web PubSub connection string | `deploy.sh`, once, from the resource's keys | Key Vault `web-pubsub-connection-string` | web app (app setting) |
| `bootstrap-token` | Bicep, `newGuid()` parameter default; rotates on every infra deploy | Key Vault | web app (app setting); the owner reads it once (step 9) |
| `glucose-<spaceId>` (Dexcom credential) | the Function App's `source-connect` trigger from Settings | Key Vault | the poller, through its managed identity |
| Function App storage key, App Insights connection string | Azure | app settings | the Function App (the Functions host on a Consumption plan needs a key-based `AzureWebJobsStorage`; the key never leaves Azure) |

Why the deploy principal is the SQL server's Entra admin: Prisma cannot authenticate with Entra
tokens, so the application needs a SQL login; Bicep must never hold a password; so the login is
created by `deploy.sh` through `sqlcmd` with the pipeline's own identity, and the password it
generates goes straight into Key Vault. Bicep creates the server Entra-only (which lets the SQL admin
be omitted) and then turns SQL authentication on with the `azureADOnlyAuthentications/Default` child
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
   audience `api://AzureADTokenExchange`, one per subject:
   - `repo:nicklasjepsen/frejsi:environment:production-infra`
   - `repo:nicklasjepsen/frejsi:environment:production`
   - `repo:nicklasjepsen/frejsi:environment:preview` (optional; only for `preview.yml`)
4. **Role assignments** for the app registration's service principal on the resource group:
   **Owner**, or Contributor plus User Access Administrator (the deployment creates role assignments
   for the Function App's identity and for the deploy principal itself). Key Vault data-plane access is
   granted by Bicep, not by hand.
5. **Repository variables** (Settings → Secrets and variables → Actions → Variables):
   `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `ALERT_EMAIL` (where the
   35-minute alert goes). Leave `CUSTOM_DOMAIN` unset until step 7. The environments
   `production-infra` (owner as required reviewer) and `production` exist already; `preview` is
   created on first use of `preview.yml` if you want previews. The repository secret
   `CI_SQL_SA_PASSWORD` (the full suite's SQL Server container) already exists;
   `ANTHROPIC_API_KEY_EVALS` is not needed before v0.4.0.
6. **First release.** When the milestone is tagged, `release.yml` stops at the `infra` job for your
   approval: one tap. The deployment takes about ten minutes (the SQL server is the slow one). If the
   `bootstrap-token` secret fails with a 403 on the very first run, that is role propagation; the job
   retries once after a minute. The `deploy` job then creates the SQL login, the Key Vault secrets,
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

## Deploy your own in 15 minutes

Frejsi is one person's data on one person's subscription. A fork gets its own copy like this:

1. Fork the repository. In your fork, keep `baseName` as it is or set it in `main.bicepparam`
   (at most 7 characters; names stay globally unique through a suffix derived from the resource
   group id).
2. Do steps 1–5 above in your own Azure subscription and GitHub repository, with your own
   repository name in the federated credential subjects (`repo:<you>/<fork>:environment:...`). Create
   the two environments `production-infra` and `production` in the fork (Settings → Environments),
   with yourself as required reviewer on `production-infra`. Add the repository secret
   `CI_SQL_SA_PASSWORD` (any strong password; it is only for the SQL Server container the release
   suite starts).
3. Create a milestone titled `v0.1.0` with no open issues and push the tag `v0.1.0`. Approve the
   infra job when it asks. The site is at the Static Web App's default hostname.
4. Optional: your own domain, as in step 7. Optional: `ALERT_EMAIL` must be set; it is your
   address, not ours.

Nothing Danish is hard-coded: the UI ships in `da` and `en`, and the glucose and food sources are
plugins. Docker Compose for non-Azure hosting is planned for a later version (spec section 9).

## What `deploy.sh` does, in order

1. Fails on the first missing variable (`AZURE_SUBSCRIPTION_ID`, `AZURE_RESOURCE_GROUP`,
   `APP_VERSION`) before touching Azure, and checks the tools it needs are present.
2. Finds the Key Vault, SQL server, Web PubSub, Function App, Static Web App and Application
   Insights by type in the resource group.
3. If `database-url` is absent in Key Vault: generates a 40-character password, creates the SQL login
   and database user as the Entra admin (`sqlcmd --authentication-method ActiveDirectoryDefault`,
   SQL from a mode-600 file, never argv), and stores the Prisma URL. If
   `web-pubsub-connection-string` is absent: reads the primary connection string and stores it.
   Neither is ever rotated by a deploy; rotate by deleting the secret and releasing (and, for SQL,
   `ALTER LOGIN` runs because the login exists).
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

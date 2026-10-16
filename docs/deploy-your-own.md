# Deploy your own

This walks a fork from nothing to a running site on your own Azure subscription. It is written for
one person setting up a copy for one family. The reference for what gets created and why is
[infra/README.md](../infra/README.md); the day-to-day runbook is [operations.md](operations.md).
Every name in capitals below is a repository variable, a repository secret or an app setting that the
workflows, `infra/main.bicepparam` or `infra/deploy.sh` really read; a test keeps this page and those
files equal (`shared/src/docs-names.test.ts`).

Nothing here is Danish. The language of the app, the food databases and the glucose source are
settings and plugins: see [Choose your country](#choose-your-country-and-your-sources).

## What you need

- An Azure subscription you can create resources in, and the right to assign roles on a resource
  group of your own. The deployment creates role assignments, so Contributor alone is not enough.
- A GitHub account and a fork of this repository, with Actions switched on in the fork (GitHub
  leaves workflows off in a new fork until you enable them on the Actions tab).
- An address to send the "no readings" alert to.
- Optional: a domain you can add a CNAME record to. The default address is
  `<something>.azurestaticapps.net`.
- About fifteen minutes of your own steps, then a wait. Honest timings: the first release takes
  **35 to 50 minutes** from start to finish. The full test suite is the first stretch, then your
  one tap, then the Bicep job of about ten minutes (Azure SQL is the slow one), then the deployment
  and the smoke check. Later releases that change no Bicep file are shorter, because they skip the
  Bicep job and its tap.

### What it costs

Prices are West Europe list prices in October 2026 at about 6.9 DKK per USD; check the invoice after
the first month.

| Resource                             | Tier                                 | Purpose                                                               | DKK / month         |
| ------------------------------------ | ------------------------------------ | --------------------------------------------------------------------- | ------------------- |
| Static Web App                       | Standard                             | hybrid Next.js (UI + API routes), custom domain, preview environments | ~62                 |
| Function App                         | Linux Consumption (Y1), Node 22      | the poller, every 5 minutes; well inside the free grant               | ~0                  |
| Storage account                      | Standard LRS                         | the Function App's own storage (not photos)                           | <1                  |
| Azure SQL                            | Basic, 5 DTU, 2 GB                   | all data; always on, so the poller never has to wake it               | ~34                 |
| Web PubSub                           | Free (F1)                            | live push, 20 connections, 20k messages/day                           | 0                   |
| Key Vault                            | Standard, RBAC                       | the secrets in [infra/README.md](../infra/README.md#how-secrets-work) | <1                  |
| Log Analytics + Application Insights | Pay-as-you-go, 1 GB/day cap, 30 days | telemetry and the one alert                                           | 0 (under 5 GB free) |
| Action group + scheduled query alert | none                                 | "no reading for 35 minutes" to `ALERT_EMAIL`                          | 0                   |
| Photo storage account                | Standard LRS                         | private originals and thumbnails, seven-day soft delete               | ~1-3                |
| **Total**                            |                                      |                                                                       | **~98-100**         |

The Standard Static Web App is two thirds of the bill. On the Free plan (a custom domain is still
included; no SLA, no managed backend scaling) the total is about 35 DKK a month; the change is one
word in `infra/modules/staticwebapp.bicep`. AI help is optional and metered by whichever provider you
choose; the estimate is in [infra/README.md](../infra/README.md#optional-ai-adapters-v040). With the
repository variable `SQL_SERVER_ID` set, the database sits on a SQL server you already pay for
instead of a new one ([an existing SQL server](../infra/README.md#an-existing-sql-server)).

## 1. Fork and name things

Fork the repository. Keep `baseName` as it is, or set it in `infra/main.bicepparam` (at most seven
characters; resource names stay globally unique through a suffix derived from the resource group).

Create a resource group for Frejsi alone: any name, any region Static Web Apps supports (West Europe
works). Nothing else may live in it, because `deploy.sh` finds each resource by type and expects
exactly one of each. If you do not call the group `frejsi`, set the repository variable
`AZURE_RESOURCE_GROUP` to its name in step 4.

```sh
az group create -n <your resource group> -l westeurope --subscription <subscription id>
```

## 2. The Entra app registration and its federated credentials

The pipeline signs in to Azure with OpenID Connect. No client secret is created, ever.

```sh
az ad app create --display-name frejsi-deploy --query appId -o tsv   # the client id
az ad sp create --id <client id>
```

Note the application (client) ID, the tenant ID and the subscription ID: they become the variables
`AZURE_CLIENT_ID`, `AZURE_TENANT_ID` and `AZURE_SUBSCRIPTION_ID`.

Add one federated credential per GitHub environment, issuer
`https://token.actions.githubusercontent.com`, audience `api://AzureADTokenExchange`:

- `production-infra`, for the Bicep job (the one that waits for your tap),
- `production`, for the deploy job,
- `preview`, **only** if you want a Static Web App preview for pull requests. Previews work only
  after the first release has created the site.

The subject of each is `<prefix>:environment:<name>`, where `<prefix>` is what GitHub presents for
your repository. Read it instead of guessing:

```sh
gh api repos/<you>/<fork>/actions/oidc/customization/sub --jq .sub_claim_prefix
```

A repository created today gets an immutable prefix that carries its owner and repository IDs, for
example `repo:<you>@<owner id>/<fork>@<repository id>`, so never copy another repository's subject.
If the command prints nothing, the older form `repo:<you>/<fork>` applies. A wrong subject fails the
login with `AADSTS700213: No matching federated identity record found`.

```sh
az ad app federated-credential create --id <client id> --parameters '{
  "name": "production-infra",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "<prefix>:environment:production-infra",
  "audiences": ["api://AzureADTokenExchange"]
}'
```

Repeat for `production` and, if you want previews, `preview`.

## 3. Roles for the pipeline

Assign the app registration's service principal **Owner** on the resource group, or Contributor plus
User Access Administrator: the deployment creates role assignments for the Function App's identity
and for the pipeline itself. Key Vault data access is granted by Bicep, not by hand.

```sh
az role assignment create --assignee <client id> --role Owner \
  --scope /subscriptions/<subscription id>/resourceGroups/<your resource group>
```

One read-only grant is needed at **subscription** scope: a custom role with the action
`Microsoft.Web/locations/*/read`. Azure polls asynchronous Static Web Apps operations (the custom
domain) at `/subscriptions/<id>/providers/Microsoft.Web/locations/<region>/staticSitesOperationStatuses/...`,
outside the resource group. Without the grant the Bicep job hangs with `AuthorizationFailed` until it
times out. The exact action is not a registered operation, so only the wildcard can grant it.

```sh
az role definition create --role-definition '{
  "Name": "frejsi-swa-operations-reader",
  "Description": "Read the status of asynchronous Static Web Apps operations",
  "Actions": ["Microsoft.Web/locations/*/read"],
  "AssignableScopes": ["/subscriptions/<subscription id>"]
}'
az role assignment create --assignee <client id> --role frejsi-swa-operations-reader \
  --scope /subscriptions/<subscription id>
```

## 4. GitHub environments, variables and secrets

In the fork, under Settings, Environments, create `production-infra` and `production`. Put yourself
as **required reviewer** on `production-infra`: that is the one tap that lets Bicep change your
Azure resources. For previews also create `preview` and set the variable `PREVIEWS_ENABLED` to
`true`, which turns on the cleanup job that runs when a pull request closes.

Under Settings, Secrets and variables, Actions:

| Kind     | Name                    | Value                                                                                                                                                                                                                                    |
| -------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| variable | `AZURE_CLIENT_ID`       | the app registration's client ID                                                                                                                                                                                                         |
| variable | `AZURE_TENANT_ID`       | your tenant ID                                                                                                                                                                                                                           |
| variable | `AZURE_SUBSCRIPTION_ID` | your subscription ID                                                                                                                                                                                                                     |
| variable | `AZURE_RESOURCE_GROUP`  | the resource group's name, if it is not `frejsi`                                                                                                                                                                                         |
| variable | `DEFAULT_LOCALE`        | `da` or `en`: the language a visitor with no preference gets (unset means `da`)                                                                                                                                                          |
| variable | `FOOD_SOURCES`          | the food plugins to switch on, for example `off` or `off,frida`                                                                                                                                                                          |
| variable | `OFF_COUNTRY`           | a two-letter country code Open Food Facts should prefer; unset means the whole world                                                                                                                                                     |
| variable | `OFF_CONTRIBUTE_HOST`   | optional, only with the Open Food Facts account of [step 9](#9-optional-ai-help-and-sending-corrections-to-open-food-facts): the host corrections go to; unset is production, `world.openfoodfacts.net` is the staging host to try first |
| variable | `CUSTOM_DOMAIN`         | leave unset until [step 6](#6-the-custom-domain-before-the-bootstrap)                                                                                                                                                                    |
| variable | `SQL_SERVER_ID`         | only for [an existing SQL server](../infra/README.md#an-existing-sql-server)                                                                                                                                                             |
| variable | `PREVIEWS_ENABLED`      | only with the `preview` environment: `true`                                                                                                                                                                                              |
| secret   | `ALERT_EMAIL`           | where the "no readings for 35 minutes" alert goes                                                                                                                                                                                        |
| secret   | `CI_SQL_SA_PASSWORD`    | any strong password; only for the SQL Server container the release suite starts                                                                                                                                                          |

`ALERT_EMAIL` is a secret and not a variable because the run logs of a public repository are public
and variables are printed in them unmasked. Frejsi also uses the address as the contact of its
browser push messages.

```sh
gh variable set AZURE_CLIENT_ID --body <client id>
gh secret set ALERT_EMAIL        # reads the value from the prompt
```

Optional secrets, none needed to deploy:

- `ANTHROPIC_API_KEY_EVALS`: a dedicated key the full release suite uses for its live AI checks.
  Without it the evals run against recorded answers only.
- `ANTHROPIC_API_KEY` and `CLAUDE_CODE_OAUTH_TOKEN`: only for `housekeeping.yml`, the daily
  background triage of the upstream project's agent workflow. A fork can leave the workflow off.

### Choose your country and your sources

Nothing Danish is built in; the product is Danish-first only because its owner is. Three variables
carry the choice, and the release pipeline writes them to the web app's settings on every release:

- `DEFAULT_LOCALE`: `da` or `en`. People can still choose their own language in Settings.
- `FOOD_SOURCES`: a comma-separated list of food plugin ids. `off` is Open Food Facts (any country);
  `frida` is the bundled Danish DTU Frida dataset. With none set there is no plugin and the search
  finds only your own library: set it.
- `OFF_COUNTRY`: the two-letter code (for example `no`, `se`, `gb`) Open Food Facts should favour.

A variable that is unset or empty writes nothing. The web app's settings are rebuilt on every
release, so it then loses the setting; the Function App only ever gains settings, so it keeps the
last value the pipeline wrote until you remove it by hand
(`az functionapp config appsettings delete -g <your resource group> -n <function app> --setting-names FOOD_SOURCES OFF_COUNTRY`).

A glucose source is chosen per space in Settings after the site is running: Dexcom Share, Nightscout
or typed-in finger-prick values. A new food or glucose source for your country is a plugin: see
[plugins/food-source.md](plugins/food-source.md) and [plugins/glucose-source.md](plugins/glucose-source.md).

## 5. The first release

A release is a tag plus a milestone with the tag's title, and a fork starts with the upstream's tags
and none of its milestones. A tag that already exists fires nothing when you "push" it, so the first
release is started by hand against an existing tag:

1. Pick the tag to deploy: `git ls-remote --tags origin 'v*'` lists what your fork has.
2. In the fork create a **milestone** titled exactly like that tag. It may be closed; a hand-started
   run does not check for open issues.
3. Actions, `release`, **Run workflow** (the `workflow_dispatch` trigger). Enter the tag, and tick the
   **infra** box. A fork has no earlier release to compare with, so the Bicep job runs anyway; the box
   is what makes it run again later when only a repository variable changed.

If your fork has no tag at all, create the milestone first and push a tag of your own
(`git tag v0.1.0 && git push origin v0.1.0`): a new tag starts the release by itself, and on a first
release the Bicep job runs, so you can skip step 3.

4. Approve the `production-infra` environment when the run asks for it. The Bicep job takes about
   ten minutes. If the `bootstrap-token` secret fails with a 403 on the very first run, that is role
   propagation: the job retries once after a minute.
5. The deploy job creates the database user and the Key Vault secrets, runs the migrations and
   deploys the poller and the web app, then reads `https://<default hostname>/api/health`.

Where the site is: the Static Web App's default hostname, from the portal or

```sh
az staticwebapp list -g <your resource group> --query '[0].defaultHostname' -o tsv
```

If Azure answers "Provisioning is restricted in this region" for the SQL server, see
[an existing SQL server](../infra/README.md#an-existing-sql-server).

From now on, a pushed `vX.Y.Z` tag whose milestone has no open issues starts a release by itself; the
Bicep job and its tap only appear when a Bicep file changed since the last tag whose Bicep job
succeeded.

### How the database is reached

The poller runs unattended every five minutes, so it holds no database password: it connects with a
user-assigned managed identity that the Bicep creates, named `id-<baseName>-<suffix>` in Azure, and
`deploy.sh` makes the identity a contained database user with read and write rights only. The web
app is different. Static Web Apps gives hybrid Next.js no usable managed identity, so the web app
keeps a SQL login whose connection string `deploy.sh` copies from Key Vault into its settings, and
migrations run in the pipeline through the same login. A fork needs no extra step for any of this:
the release pipeline performs the cutover from a password to the identity, and repeats the
idempotent part on every release. The details, and what to look for if the poller cannot sign in,
are in the cutover section of [infra/README.md](../infra/README.md).

## 6. The custom domain, before the bootstrap

Do this before you create the first space. A passkey is bound to the hostname that
`APP_ORIGIN` names. An owner who registers on `<something>.azurestaticapps.net` cannot sign in on
your domain later, and there is no way to move a passkey.

1. At your DNS provider create a CNAME from your name (for example `frejsi.example.org`) to the
   default hostname from step 5. If the provider cannot CNAME (an apex domain), use the TXT record the
   portal's "Custom domains" page shows instead.
2. Set the repository variable `CUSTOM_DOMAIN` to the name.
3. Run `release` again by hand with **the same tag** and the **infra** box ticked. A changed variable
   is invisible to the file diff that otherwise decides whether the Bicep job runs, which is what the
   box is for. The Bicep job adds the domain (it validates the CNAME, so the record must exist first)
   and `deploy.sh` sets `APP_ORIGIN` to it. The certificate is issued and renewed by Static Web Apps.

If you skip the domain, the default hostname is your address and nothing else changes.

## 7. Read the bootstrap token and create the first space

You need Key Vault Secrets User on the vault to read `bootstrap-token`. Give it to yourself:

```sh
az role assignment create --assignee <your user principal name> --role "Key Vault Secrets User" \
  --scope $(az keyvault list -g <your resource group> --query "[0].id" -o tsv)
```

Or read the secret on the portal's Secrets page. The token **rotates on every infra deploy**, so
read it after the last one. The route that uses it answers `404` once a space exists, and nobody
needs the token again.

```sh
VAULT=$(az keyvault list -g <your resource group> --query "[0].name" -o tsv)
TOKEN=$(az keyvault secret show --vault-name "$VAULT" -n bootstrap-token --query value -o tsv)
curl -fsS -X POST https://<your address>/api/bootstrap \
  -H "content-type: application/json" -H "x-bootstrap-token: $TOKEN" \
  -d '{"spaceName":"<space name>","ownerName":"<your name>","timezone":"<IANA time zone>"}'
unset TOKEN
```

The answer holds `inviteUrl`. Open it on your phone and create a passkey; it works once and expires
after seven days. [operations.md](operations.md#bootstrap-the-first-space) has the PowerShell
version and what each answer means. Then invite everyone else from Personer.

## 8. Connect a glucose source

In Settings, under Glukosekilde, choose Dexcom Share, Nightscout or Manuelt. The credential goes
straight to Key Vault and never to the database. Until a source is connected the screens say so and
the curve stays empty.

### The alert, and what it means for a manual-only deployment

"Frejsi: no glucose reading stored for 35 minutes" e-mails `ALERT_EMAIL` when no reading has been
stored for 35 minutes. It counts the `reading.stored` event, which the poller sends for each new
sensor reading and the typed-in value route sends for each finger-prick. On a deployment whose only
source is Manuelt it therefore fires whenever nobody has measured for 35 minutes. That is true, not a
fault: it resolves itself with the next typed value. You can disable the rule in the portal, but a
later infra deploy may switch it back on. See [the 35-minute alert](operations.md#the-35-minute-alert).

## 9. Optional: AI help, and sending corrections to Open Food Facts

AI help is off until you give the deployment a provider's settings and a space opts in. The settings
are Key Vault secrets that `deploy.sh` copies into the app's settings only when they exist; a release
without them succeeds. The names and the example command are in
[infra/README.md](../infra/README.md#optional-ai-adapters-v040). Sending a family's correction to
Open Food Facts is also optional: it needs the Key Vault secrets `off-contribute-user` and
`off-contribute-password` (an Open Food Facts account; try it on the staging host first, with
`OFF_CONTRIBUTE_HOST`), and without them no screen offers it. The commands are in
[infra/README.md](../infra/README.md#optional-off-secrets-and-the-country-variables).

## Docker Compose (any host with Docker)

The same app on a machine of your own, with no Azure account: a laptop, a home server, a small VPS.
Everything is in [docker/](../docker/README.md). It is a second way to run Frejsi, not a replacement:
the Azure path above is the one every release is shipped and checked on.

**Prerequisites.** Docker with the Compose plugin (`docker compose version` prints a version),
`bash`, `git`, and about 4 GB of free memory: SQL Server alone asks for 2 GB. Nothing else is
installed on the host.

**The four commands.**

```sh
git clone https://github.com/<your fork or the upstream repository>/frejsi.git && cd frejsi
docker/init-secrets.sh
docker compose -f docker/compose.yaml up --build -d
# then, once /api/health answers (about a minute after the build):
TOKEN=$(sed -n 's/^BOOTSTRAP_TOKEN="\(.*\)"/\1/p' docker/.env)
curl -fsS -X POST http://localhost:3000/api/bootstrap \
  -H "content-type: application/json" -H "x-bootstrap-token: $TOKEN" \
  -d '{"spaceName":"<space name>","ownerName":"<your name>","timezone":"<IANA time zone>"}'
unset TOKEN
```

`init-secrets.sh` writes `docker/.env` (mode 600, ignored by git and by Docker) with a generated SQL
password, bootstrap token, poller key and storage key, and puts the poller's function key in a Docker
volume. It never prints them and never writes inside the repository tree anywhere else. The answer
to the bootstrap holds `inviteUrl`: open it in a browser and create a passkey, as in
[step 7](#7-read-the-bootstrap-token-and-create-the-first-space). Then connect a source in Settings
under Glukosekilde (step 8). Without a sensor, choose Manuelt and type finger-pricks in. `FAKE_GLUCOSE_SOURCE=1` in `docker/.env` is
for checking the stack, not for trying the app: the poller then stores fictional readings for every
space that already has a source configured, but the Settings form still checks a real service
before it saves one.

**Passkeys need the right address, before the first bootstrap.** A passkey is bound to the origin in
`APP_ORIGIN`, as in [step 6](#6-the-custom-domain-before-the-bootstrap). On one machine leave it at
`http://localhost:3000`. For anyone else on the network, put a TLS proxy in front of port 3000 (a
passkey needs https on any name but `localhost`), set `APP_ORIGIN` in `docker/.env` to the real
`https://` hostname, and run `docker compose -f docker/compose.yaml up -d` before you bootstrap. An
owner who registers on `localhost` cannot sign in on another name later. Photos are read by the
browser straight from port 10000 of the same host: if the app is not on `localhost`, also set
`BLOB_PUBLIC_ENDPOINT` to an address a browser can reach (for the same host name, port 10000).

**What is different from Azure.**

- The app polls instead of receiving pushes: there is no Web PubSub, so a second device sees a new
  reading within its polling interval and not at once.
- Secrets are one file per secret in a Docker volume (`SECRETS_DIR`), not Key Vault. Anyone who can
  read that volume on the host can read a Nightscout or Dexcom credential: protect the host as you
  would protect the vault.
- No "no readings for 35 minutes" alert (it is an Azure Monitor rule), no Application Insights, and
  no preview deployments.
- Updating and backups are yours, below.

**Update.** `git pull`, then `docker compose -f docker/compose.yaml up --build -d`. The one-shot
`migrate` service runs `prisma migrate deploy` before `web` and `poller` start, so a new version's
migrations are applied in order and nothing starts on a half-migrated database. Roll back by checking
out the older tag and running the same command; a migration is not undone by that.

**Where the data lives.** Two named volumes hold it: `frejsi_sql-data` (the database) and
`frejsi_azurite-data` (photos). `docker/init-secrets.sh` made two more, `frejsi-host-keys` and
`frejsi-credentials`, which hold the keys. `docker compose down` keeps all of them; `down -v` deletes
the first two, and your data with them. Back the database up with SQL Server itself:

```sh
docker compose -f docker/compose.yaml exec sql sh -c '/opt/mssql-tools18/bin/sqlcmd -C -S localhost -U sa \
  -P "$MSSQL_SA_PASSWORD" -Q "BACKUP DATABASE frejsi TO DISK = N'"'"'/var/opt/mssql/data/frejsi.bak'"'"' WITH INIT"'
docker compose -f docker/compose.yaml cp sql:/var/opt/mssql/data/frejsi.bak ./frejsi.bak
```

Keep the copy away from the host. Photos are backed up by copying the `frejsi_azurite-data` volume.

**What was checked, and what was not.** docker/README.md records the run: the stack from a clean
state, the bootstrap, the poller's `source-connect` over the Compose network writing a Nightscout
credential as a mode-600 file, the timer then storing that source's readings, fictional readings
from `FAKE_GLUCOSE_SOURCE=1`, and a photo link served from Azurite. Not driven by hand: the Settings
screen in a browser with a passkey session, a photo uploaded from the app, and a second device.
Compose is not part of the release workflow; `compose-check` builds it on pull requests that touch
`docker/`.

## When something goes wrong

- A release that fails keeps its tag but publishes no GitHub release. Fix forward with the next patch
  version, or redeploy an older tag by running `release` by hand with that tag.
- `AADSTS700213` on login: the federated credential's subject does not match, see step 2.
- The Bicep job waits forever on `AuthorizationFailed`: the subscription-scope read role of step 3.
- A `403` on `bootstrap-token` during the first run: Azure role propagation; the job retries once,
  and you can rerun it.
- The poller logs `Login failed` for the managed identity: the release pipeline recreates its
  database user on every release, so rerunning the deploy job repairs it.
- Rolling back, rotating keys, importing history: [operations.md](operations.md).

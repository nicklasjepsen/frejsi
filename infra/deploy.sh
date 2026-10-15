#!/usr/bin/env bash
# Frejsi production deploy. Called by release.yml (job `deploy`) after `infra/main.bicep` has been
# applied; never from a session (docs/agent-workflow.md section 9).
#
# What it does, in order:
#   1. finds the resources in the resource group (one of each type; nothing else lives there)
#   2. creates the secrets that exist only once: the SQL application login and its password, and
#      the Web PubSub connection string, written to Key Vault if absent (never rotated here)
#   3. opens a temporary SQL firewall rule for this runner, runs `prisma migrate deploy`, closes it
#   4. deploys poller/dist as a zip (SCM_DO_BUILD_DURING_DEPLOYMENT=false, APP_VERSION) and checks
#      the app runs from the package
#   5. writes the Static Web App's settings (plan section 7) from Key Vault and Bicep outputs
#   6. uploads the standalone Next.js build to the Static Web App
#
# Required environment: AZURE_SUBSCRIPTION_ID, AZURE_RESOURCE_GROUP, APP_VERSION (the tag).
# Optional: CUSTOM_DOMAIN (sets APP_ORIGIN; otherwise the default hostname), GITHUB_OUTPUT,
# PHOTOS_STORAGE_ACCOUNT (dedicated photo account; creates blob-connection-string once).
# Tools: az (logged in), sqlcmd (go-sqlcmd), pnpm (workspace installed), docker, curl, zip, openssl, jq.
#
# Nothing secret is ever printed. Secrets travel through files with mode 600 or environment
# variables, never through command lines, `echo` or `set -x`.
#
# Every value read from Azure is captured with a plain assignment (`x="$(az ...)"`), never with a
# command substitution inside an argument or a process substitution: those hide a failed `az` from
# `set -e`, and the script would go on with an empty value. Empty is always an error here.

set -euo pipefail

# --- 0. Inputs: fail on the first missing variable, before anything touches Azure ---------------
: "${AZURE_SUBSCRIPTION_ID:?AZURE_SUBSCRIPTION_ID is required}"
: "${AZURE_RESOURCE_GROUP:?AZURE_RESOURCE_GROUP is required}"
: "${APP_VERSION:?APP_VERSION is required (the release tag)}"
CUSTOM_DOMAIN="${CUSTOM_DOMAIN:-}"
PHOTOS_STORAGE_ACCOUNT="${PHOTOS_STORAGE_ACCOUNT:-}"
if [ -n "$PHOTOS_STORAGE_ACCOUNT" ] && ! [[ "$PHOTOS_STORAGE_ACCOUNT" =~ ^[a-z0-9]{3,24}$ ]]; then
  echo "::error::PHOTOS_STORAGE_ACCOUNT must be a storage account name" >&2; exit 1
fi
WEB_PUBSUB_HUB="${WEB_PUBSUB_HUB:-frejsi}"
SQL_DATABASE="${SQL_DATABASE:-frejsi}"
SQL_APP_LOGIN="${SQL_APP_LOGIN:-frejsi_app}"
POLLER_DIST="${POLLER_DIST:-poller/dist}"
WEB_DIR="${WEB_DIR:-web}"
RETRY_SLEEP="${DEPLOY_RETRY_SLEEP:-15}"

for tool in az sqlcmd pnpm docker curl zip openssl mktemp jq; do
  command -v "$tool" >/dev/null 2>&1 || { echo "::error::$tool is not installed on this runner" >&2; exit 1; }
done
test -d "$POLLER_DIST" || { echo "::error::$POLLER_DIST is missing; was the build artifact downloaded?" >&2; exit 1; }
test -d "$WEB_DIR/.next/standalone" || { echo "::error::$WEB_DIR/.next/standalone is missing; the web build must use output: standalone" >&2; exit 1; }

RG="$AZURE_RESOURCE_GROUP"
WORK="$(mktemp -d)"
chmod 700 "$WORK"
FIREWALL_RULE=""
SQL_SERVER=""

cleanup() {
  local status=$?
  if [ -n "$FIREWALL_RULE" ] && [ -n "$SQL_SERVER" ]; then
    echo "Closing the SQL firewall rule $FIREWALL_RULE"
    az sql server firewall-rule delete -g "$RG" --server "$SQL_SERVER" -n "$FIREWALL_RULE" >/dev/null 2>&1 || \
      echo "::warning::could not delete firewall rule $FIREWALL_RULE; remove it by hand"
  fi
  rm -rf "$WORK"
  exit "$status"
}
trap cleanup EXIT

log() { printf '==> %s\n' "$*"; }

# --- 1. Discover the resources (exactly one of each type in the group) ---------------------------
one_resource() {
  local type="$1" names count
  names="$(az resource list -g "$RG" --resource-type "$type" --query "[].name" -o tsv)"
  count="$(printf '%s\n' "$names" | grep -c . || true)"
  if [ "$count" != "1" ]; then
    echo "::error::expected exactly one $type in resource group $RG, found $count" >&2
    exit 1
  fi
  printf '%s' "$names"
}

log "Finding resources in $RG"
KEY_VAULT="$(one_resource Microsoft.KeyVault/vaults)"
SQL_SERVER="$(one_resource Microsoft.Sql/servers)"
WEB_PUBSUB="$(one_resource Microsoft.SignalRService/webPubSub)"
FUNCTION_APP="$(one_resource Microsoft.Web/sites)"
STATIC_WEB_APP="$(one_resource Microsoft.Web/staticSites)"
APP_INSIGHTS="$(one_resource Microsoft.Insights/components)"
SQL_FQDN="$(az sql server show -g "$RG" -n "$SQL_SERVER" --query fullyQualifiedDomainName -o tsv)"
log "Key Vault $KEY_VAULT, SQL $SQL_SERVER, Web PubSub $WEB_PUBSUB, Function App $FUNCTION_APP, Static Web App $STATIC_WEB_APP"

# --- Secret helpers: values go through files, never command lines or stdout ----------------------
# The names are listed once, with an assignment: a failed listing stops the script here. Inside an
# `if` it would read as "absent" and the SQL branch would rotate the live application password.
EXISTING_SECRETS="$(az keyvault secret list --vault-name "$KEY_VAULT" --query "[].name" -o tsv)"
secret_exists() { printf '%s\n' "$EXISTING_SECRETS" | grep -qx "$1"; }
secret_read() { az keyvault secret show --vault-name "$KEY_VAULT" -n "$1" --query value -o tsv; }
secret_write_from_file() { az keyvault secret set --vault-name "$KEY_VAULT" -n "$1" --file "$2" --encoding utf-8 >/dev/null; }
# secret_to_file <name> <file>: the secret's value into a mode-600 file. A failed or empty read stops
# the script, so an app setting is never written as "".
secret_to_file() {
  local value
  if ! value="$(secret_read "$1")" || [ -z "$value" ]; then
    echo "::error::Key Vault secret $1 is empty or could not be read" >&2; exit 1
  fi
  ( umask 077; printf '%s' "$value" > "$2" )
}

# --- 2. One-time secrets --------------------------------------------------------------------------
new_password() {
  # 40 alphanumerics with at least one upper, lower and digit: meets the Azure SQL policy and needs
  # no escaping in T-SQL or in a Prisma connection URL.
  local p
  while :; do
    p="$(openssl rand -base64 60 | tr -dc 'A-Za-z0-9' | head -c 40)"
    if printf '%s' "$p" | grep -q '[A-Z]' && printf '%s' "$p" | grep -q '[a-z]' && printf '%s' "$p" | grep -q '[0-9]'; then
      printf '%s' "$p"
      return
    fi
  done
}

if secret_exists database-url; then
  log "database-url exists in Key Vault; keeping it"
else
  log "Creating the SQL login $SQL_APP_LOGIN as the Entra admin and storing database-url"
  PASSWORD="$(new_password)"
  SQL_FILE="$WORK/create-login.sql"
  ( umask 077; cat > "$SQL_FILE" <<EOSQL
IF NOT EXISTS (SELECT 1 FROM sys.sql_logins WHERE name = N'$SQL_APP_LOGIN')
  CREATE LOGIN [$SQL_APP_LOGIN] WITH PASSWORD = N'$PASSWORD';
ELSE
  ALTER LOGIN [$SQL_APP_LOGIN] WITH PASSWORD = N'$PASSWORD';
EOSQL
  )
  SQL_USER_FILE="$WORK/create-user.sql"
  ( umask 077; cat > "$SQL_USER_FILE" <<EOSQL
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'$SQL_APP_LOGIN')
  CREATE USER [$SQL_APP_LOGIN] FOR LOGIN [$SQL_APP_LOGIN];
ALTER ROLE db_owner ADD MEMBER [$SQL_APP_LOGIN];
EOSQL
  )
  # The runner must reach the server for this too; the rule is opened once, below, before use.
  NEED_FIREWALL_FOR_LOGIN=1
  DATABASE_URL_FILE="$WORK/database-url"
  ( umask 077; printf 'sqlserver://%s:1433;database=%s;user=%s;password=%s;encrypt=true' \
      "$SQL_FQDN" "$SQL_DATABASE" "$SQL_APP_LOGIN" "$PASSWORD" > "$DATABASE_URL_FILE" )
  unset PASSWORD
fi

if secret_exists web-pubsub-connection-string; then
  log "web-pubsub-connection-string exists in Key Vault; keeping it"
else
  log "Storing the Web PubSub connection string in Key Vault"
  WPS_ID="/subscriptions/$AZURE_SUBSCRIPTION_ID/resourceGroups/$RG/providers/Microsoft.SignalRService/webPubSub/$WEB_PUBSUB"
  WPS_FILE="$WORK/wps"
  # An assignment, so a failed listKeys stops the script instead of storing an empty secret that
  # every later release would reuse. $(...) drops the trailing newline: the bare connection string.
  WPS_CONNECTION="$(az rest --method post --url "https://management.azure.com${WPS_ID}/listKeys?api-version=2024-03-01" \
      --query primaryConnectionString -o tsv)"
  if [ -z "$WPS_CONNECTION" ]; then echo "::error::listKeys on $WEB_PUBSUB returned no connection string" >&2; exit 1; fi
  ( umask 077; printf '%s' "$WPS_CONNECTION" > "$WPS_FILE" )
  unset WPS_CONNECTION
  secret_write_from_file web-pubsub-connection-string "$WPS_FILE"
fi

# Find the dedicated photos account on its first release. Existing installations without the
# module still work; multiple tagged accounts are ambiguous and must fail before reading keys.
if [ -z "$PHOTOS_STORAGE_ACCOUNT" ] && ! secret_exists blob-connection-string; then
  PHOTOS_STORAGE_ACCOUNT="$(az resource list -g "$RG" --resource-type Microsoft.Storage/storageAccounts \
    --query "[?tags.purpose=='photos'].name" -o tsv)"
  PHOTO_ACCOUNT_COUNT="$(printf '%s\n' "$PHOTOS_STORAGE_ACCOUNT" | grep -c . || true)"
  if [ "$PHOTO_ACCOUNT_COUNT" -gt 1 ]; then
    echo "::error::multiple purpose=photos storage accounts" >&2; exit 1
  fi
fi
if [ -n "$PHOTOS_STORAGE_ACCOUNT" ] && ! secret_exists blob-connection-string; then
  BLOB_CONNECTION="$(az storage account show-connection-string -g "$RG" -n "$PHOTOS_STORAGE_ACCOUNT" \
      --query connectionString -o tsv)"
  if [ -z "$BLOB_CONNECTION" ]; then echo "::error::photo storage returned no connection string" >&2; exit 1; fi
  ( umask 077; printf '%s' "$BLOB_CONNECTION" > "$WORK/blob" )
  unset BLOB_CONNECTION
  secret_write_from_file blob-connection-string "$WORK/blob"
fi

# --- 3. Firewall rule for this runner, then the login (first time) and the migration -------------
# Bounded: a hung lookup must fail fast, not sit until the job's timeout.
RUNNER_IP="$(curl -fsS --max-time 10 --retry 3 --retry-delay 2 https://api.ipify.org)"
if ! printf '%s' "$RUNNER_IP" | grep -Eq '^[0-9]{1,3}(\.[0-9]{1,3}){3}$'; then
  echo "::error::could not determine the runner's IPv4 address" >&2; exit 1
fi
FIREWALL_RULE="github-runner-${GITHUB_RUN_ID:-local}-$(date +%s)"
log "Opening SQL firewall rule $FIREWALL_RULE for this runner"
az sql server firewall-rule create -g "$RG" --server "$SQL_SERVER" -n "$FIREWALL_RULE" \
  --start-ip-address "$RUNNER_IP" --end-ip-address "$RUNNER_IP" >/dev/null

if [ "${NEED_FIREWALL_FOR_LOGIN:-0}" = 1 ]; then
  sqlcmd -S "$SQL_FQDN" -d master --authentication-method ActiveDirectoryDefault -b -i "$SQL_FILE"
  sqlcmd -S "$SQL_FQDN" -d "$SQL_DATABASE" --authentication-method ActiveDirectoryDefault -b -i "$SQL_USER_FILE"
  secret_write_from_file database-url "$DATABASE_URL_FILE"
  log "SQL login created and database-url stored"
fi

log "Running Prisma migrations"
DATABASE_URL="$(secret_read database-url)"
if [ -z "$DATABASE_URL" ]; then echo "::error::Key Vault secret database-url is empty" >&2; exit 1; fi
export DATABASE_URL
pnpm --filter ./shared exec prisma migrate deploy
unset DATABASE_URL

log "Closing SQL firewall rule $FIREWALL_RULE"
az sql server firewall-rule delete -g "$RG" --server "$SQL_SERVER" -n "$FIREWALL_RULE" >/dev/null
FIREWALL_RULE=""

# --- 4. Poller: settings, zip, run-from-package ----------------------------------------------------
log "Deploying the poller $APP_VERSION to $FUNCTION_APP"
az functionapp config appsettings set -g "$RG" -n "$FUNCTION_APP" \
  --settings "SCM_DO_BUILD_DURING_DEPLOYMENT=false" "ENABLE_ORYX_BUILD=false" "APP_VERSION=$APP_VERSION" >/dev/null
POLLER_ZIP="$WORK/poller-$APP_VERSION.zip"
( cd "$POLLER_DIST" && zip -qr "$POLLER_ZIP" . )
az functionapp deployment source config-zip -g "$RG" -n "$FUNCTION_APP" --src "$POLLER_ZIP" >/dev/null
# Linux Consumption runs from a package URL that the zip deploy sets; make sure it did.
RUN_FROM_PACKAGE="$(az functionapp config appsettings list -g "$RG" -n "$FUNCTION_APP" \
  --query "[?name=='WEBSITE_RUN_FROM_PACKAGE'].value" -o tsv)"
if [ -z "$RUN_FROM_PACKAGE" ]; then
  echo "::error::WEBSITE_RUN_FROM_PACKAGE is not set after the zip deploy; the poller is not running from the package" >&2
  exit 1
fi
log "Poller runs from package"

# The source-connect function key appears once the host has indexed the new package.
FUNCTION_HOST="$(az functionapp show -g "$RG" -n "$FUNCTION_APP" --query defaultHostName -o tsv)"
SOURCE_CONNECT_KEY_FILE="$WORK/source-connect-key"
attempt=0
until ( umask 077; az functionapp function keys list -g "$RG" -n "$FUNCTION_APP" --function-name source-connect \
          --query default -o tsv > "$SOURCE_CONNECT_KEY_FILE" 2>/dev/null ) && [ -s "$SOURCE_CONNECT_KEY_FILE" ]; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 20 ]; then
    echo "::error::the source-connect function key never appeared on $FUNCTION_APP" >&2
    exit 1
  fi
  sleep "$RETRY_SLEEP"
done

# --- 5. Static Web App settings (plan section 7) -------------------------------------------------
SWA_DEFAULT_HOST="$(az staticwebapp show -g "$RG" -n "$STATIC_WEB_APP" --query defaultHostname -o tsv)"
if [ -n "$CUSTOM_DOMAIN" ]; then APP_ORIGIN="https://$CUSTOM_DOMAIN"; else APP_ORIGIN="https://$SWA_DEFAULT_HOST"; fi
APPI_ID="/subscriptions/$AZURE_SUBSCRIPTION_ID/resourceGroups/$RG/providers/Microsoft.Insights/components/$APP_INSIGHTS"
APPI_CONNECTION="$(az resource show --ids "$APPI_ID" --query properties.ConnectionString -o tsv)"

log "Writing app settings on $STATIC_WEB_APP (APP_ORIGIN=$APP_ORIGIN)"
# The settings are PUT as a JSON body from a mode-600 file, so no secret is ever on a command line.
# This replaces the production environment's settings wholesale: deploy.sh owns them.
SWA_ID="/subscriptions/$AZURE_SUBSCRIPTION_ID/resourceGroups/$RG/providers/Microsoft.Web/staticSites/$STATIC_WEB_APP"
SWA_SETTINGS_FILE="$WORK/swa-appsettings.json"
# Each secret is read into its own file first (a failed or empty read stops the script here, before
# anything is replaced); a process substitution would hand jq an empty stream and carry on.
secret_to_file database-url "$WORK/swa-database-url"
secret_to_file bootstrap-token "$WORK/swa-bootstrap-token"
secret_to_file web-pubsub-connection-string "$WORK/swa-wps"
( umask 077; : > "$WORK/swa-blob" )
if [ -n "$PHOTOS_STORAGE_ACCOUNT" ] || secret_exists blob-connection-string; then
  secret_to_file blob-connection-string "$WORK/swa-blob"
fi
( umask 077
  jq -n \
    --rawfile databaseUrl "$WORK/swa-database-url" \
    --rawfile bootstrapToken "$WORK/swa-bootstrap-token" \
    --rawfile wpsConnection "$WORK/swa-wps" \
    --rawfile blobConnection "$WORK/swa-blob" \
    --rawfile sourceConnectKey "$SOURCE_CONNECT_KEY_FILE" \
    --arg hub "$WEB_PUBSUB_HUB" \
    --arg sourceConnectUrl "https://$FUNCTION_HOST/api/source-connect" \
    --arg appInsights "$APPI_CONNECTION" \
    --arg appOrigin "$APP_ORIGIN" \
    --arg version "$APP_VERSION" \
    '{ properties: ({
         DATABASE_URL: ($databaseUrl | rtrimstr("\n")),
         BOOTSTRAP_TOKEN: ($bootstrapToken | rtrimstr("\n")),
         WEB_PUBSUB_CONNECTION_STRING: ($wpsConnection | rtrimstr("\n")),
         WEB_PUBSUB_HUB: $hub,
         SOURCE_CONNECT_URL: $sourceConnectUrl,
         SOURCE_CONNECT_KEY: ($sourceConnectKey | rtrimstr("\n")),
         APPLICATIONINSIGHTS_CONNECTION_STRING: $appInsights,
         APP_ORIGIN: $appOrigin,
         NEXT_PUBLIC_APP_VERSION: $version }
       + (if $blobConnection == "" then {} else {BLOB_CONNECTION_STRING: ($blobConnection | rtrimstr("\n"))} end)) }' > "$SWA_SETTINGS_FILE" )
az rest --method put --url "https://management.azure.com${SWA_ID}/config/appsettings?api-version=2024-04-01" \
  --body "@$SWA_SETTINGS_FILE" --output none

# --- 6. Web: upload the standalone build with the Static Web Apps deployment client --------------
# Hybrid Next.js on Static Web Apps cannot be deployed with the SWA CLI; the supported path is the
# deployment client that the Azure/static-web-apps-deploy action wraps. Running the same container
# keeps the whole deploy in this script.
log "Uploading the web build $APP_VERSION to $STATIC_WEB_APP"
SWA_TOKEN="$(az staticwebapp secrets list -g "$RG" -n "$STATIC_WEB_APP" --query properties.apiKey -o tsv)"
if [ -z "$SWA_TOKEN" ]; then echo "::error::$STATIC_WEB_APP has no deployment token" >&2; exit 1; fi
# The token reaches the container through a mode-600 env file and is expanded by the container's
# shell, so it is on no command line of this runner (docker's argv carries the literal $SWA_TOKEN).
SWA_ENV_FILE="$WORK/swa.env"
( umask 077; printf 'SWA_TOKEN=%s\n' "$SWA_TOKEN" > "$SWA_ENV_FILE" )
unset SWA_TOKEN
# The client writes its deployment health page into the app folder, so the mount is read-write.
# shellcheck disable=SC2016 # $SWA_TOKEN is meant for the shell inside the container
docker run --rm \
  --env-file "$SWA_ENV_FILE" \
  -v "$(pwd)/$WEB_DIR:/app" \
  --entrypoint /bin/sh \
  mcr.microsoft.com/appsvc/staticappsclient:stable \
  -c 'exec /bin/staticsites/StaticSitesClient upload --app /app --outputLocation "" --skipAppBuild true --skipApiBuild true --apiToken "$SWA_TOKEN" --verbose false'

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "app_origin=$APP_ORIGIN" >> "$GITHUB_OUTPUT"
fi
log "Deployed $APP_VERSION; the app is at $APP_ORIGIN"

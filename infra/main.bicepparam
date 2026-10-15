// Parameters for the production deployment of infra/main.bicep.
// Values that differ per installation come from the environment of the `infra` job in release.yml
// (repository variables), so a fork sets variables instead of editing this file, and no address
// or domain of a real installation is committed.
using 'main.bicep'

// Repository secret ALERT_EMAIL (a secret so the address stays out of the public run logs).
// Required: an empty value fails the deployment (minLength).
param alertEmail = readEnvironmentVariable('ALERT_EMAIL', '')

// Repository variable CUSTOM_DOMAIN, set after the first release once the CNAME exists (README step 7).
param customDomain = readEnvironmentVariable('CUSTOM_DOMAIN', '')

// Repository variable SQL_SERVER_ID: an existing SQL server for the database (README, "An existing
// SQL server"). Unset: a dedicated server in the resource group.
param sqlServerId = readEnvironmentVariable('SQL_SERVER_ID', '')

// Photos inherit location, baseName, suffix and project tags from main.bicep.
// deploy.sh discovers the dedicated purpose=photos account; no account key is a parameter.

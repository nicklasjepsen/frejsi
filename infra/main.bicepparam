// Parameters for the production deployment of infra/main.bicep.
// Values that differ per installation come from the environment of the `infra` job in release.yml
// (repository variables), so a fork sets variables instead of editing this file, and no address
// or domain of a real installation is committed.
using 'main.bicep'

// Repository variable ALERT_EMAIL. Required: an empty value fails the deployment (minLength).
param alertEmail = readEnvironmentVariable('ALERT_EMAIL', '')

// Repository variable CUSTOM_DOMAIN, set after the first release once the CNAME exists (README step 7).
param customDomain = readEnvironmentVariable('CUSTOM_DOMAIN', '')

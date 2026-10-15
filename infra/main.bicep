// Frejsi infrastructure: everything in resource group `frejsi` (spec section 1).
//
// This file is a module list and nothing else (docs/agent-workflow.md section 3): lanes append a
// module at the end and never reorder. Resources live in modules/. The release pipeline deploys it
// (`release.yml`, job `infra`); nobody runs `az deployment` from a session.
//
// Costs (infra/README.md has the table): Static Web App Standard, Function App Consumption, Azure SQL
// Basic 5 DTU, Web PubSub Free, Key Vault Standard, Log Analytics + Application Insights.
// Blob Storage for photos is deferred to v0.2.0.

targetScope = 'resourceGroup'

@description('Azure region for every resource; the resource group\'s own region by default.')
param location string = resourceGroup().location

@description('Short name used in resource names. Forks may change it; names stay globally unique through the suffix. At most 7 characters: kv-<name>-<13-char suffix> must fit Key Vault\'s 24.')
@minLength(3)
@maxLength(7)
param baseName string = 'frejsi'

@description('Address that receives the "no reading for 35 minutes" alert. Passed from the ALERT_EMAIL repository secret; never in the repository or a log.')
@minLength(3)
param alertEmail string

@description('Custom domain for the web app, for example frejsi.jepsen.ninja. Empty means none yet (first release, or a fork without a domain).')
param customDomain string = ''

@description('One-time token guarding POST /api/bootstrap. Regenerated on every deployment; the route is dead once a space exists.')
@secure()
param bootstrapToken string = newGuid()

@description('Web PubSub hub name; the web app and the poller read it from their settings.')
param webPubSubHub string = 'frejsi'

@description('Resource ID of an existing Azure SQL server that holds the database, for a subscription that cannot create one in this region or an owner who already has one. Empty: a dedicated server in this resource group. The server\'s owner prepares it once (infra/README.md); Bicep never touches it.')
param sqlServerId string = ''

@description('Tags applied to every resource. The infra test asserts project=frejsi on all of them.')
param tags object = {
  project: 'frejsi'
}

var suffix = uniqueString(resourceGroup().id)

module monitoring 'modules/monitoring.bicep' = {
  name: 'monitoring'
  params: {
    location: location
    tags: tags
    baseName: baseName
    suffix: suffix
  }
}

module keyVault 'modules/keyvault.bicep' = {
  name: 'keyvault'
  params: {
    location: location
    tags: tags
    baseName: baseName
    suffix: suffix
    bootstrapToken: bootstrapToken
  }
}

module sql 'modules/sql.bicep' = if (empty(sqlServerId)) {
  name: 'sql'
  params: {
    location: location
    tags: tags
    baseName: baseName
    suffix: suffix
  }
}

module webPubSub 'modules/webpubsub.bicep' = {
  name: 'webpubsub'
  params: {
    location: location
    tags: tags
    baseName: baseName
    suffix: suffix
    hubName: webPubSubHub
  }
}

module functionApp 'modules/functionapp.bicep' = {
  name: 'functionapp'
  params: {
    location: location
    tags: tags
    baseName: baseName
    suffix: suffix
    keyVaultUri: keyVault.outputs.vaultUri
    webPubSubHostName: webPubSub.outputs.hostName
    webPubSubHub: webPubSub.outputs.hubName
    appInsightsConnectionString: monitoring.outputs.appInsightsConnectionString
  }
}

module roles 'modules/roles.bicep' = {
  name: 'roles'
  params: {
    keyVaultName: keyVault.outputs.vaultName
    webPubSubName: webPubSub.outputs.name
    functionAppPrincipalId: functionApp.outputs.principalId
  }
}

module staticWebApp 'modules/staticwebapp.bicep' = {
  name: 'staticwebapp'
  params: {
    location: location
    tags: tags
    baseName: baseName
    suffix: suffix
    customDomain: customDomain
  }
}

module alerts 'modules/alerts.bicep' = {
  name: 'alerts'
  params: {
    location: location
    tags: tags
    baseName: baseName
    appInsightsId: monitoring.outputs.appInsightsId
    alertEmail: alertEmail
  }
}

output keyVaultName string = keyVault.outputs.vaultName
output sqlServerFqdn string = empty(sqlServerId) ? sql!.outputs.serverFqdn : '${last(split(sqlServerId, '/'))}${environment().suffixes.sqlServerHostname}'
output sqlDatabaseName string = empty(sqlServerId) ? sql!.outputs.databaseName : 'frejsi'
output webPubSubName string = webPubSub.outputs.name
output functionAppName string = functionApp.outputs.name
output staticWebAppName string = staticWebApp.outputs.name
output staticWebAppDefaultHostname string = staticWebApp.outputs.defaultHostname
output appInsightsName string = monitoring.outputs.appInsightsName

// Dedicated photo storage (v0.2.0); deployment discovers the purpose=photos account.
module photosStorage 'modules/photos-storage.bicep' = {
  name: 'photos-storage'
  params: {
    location: location
    tags: tags
    baseName: baseName
    suffix: suffix
  }
}

output photosStorageAccountName string = photosStorage.outputs.accountName

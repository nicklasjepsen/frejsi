// The poller: a Function App on a Linux Consumption (Y1) plan, Node 22, with its own storage
// account (spec section 1, plan section 7). Secrets reach it as Key Vault references resolved by
// its user-assigned identity; nothing secret is in this file or in the deployment history.
//
// The identity is user-assigned on purpose (v0.5.0 plan section 7): CREATE USER ... WITH SID needs the
// identity's client id, which ARM exposes only for a user-assigned identity, and the database login
// then needs no password and no tenant-level Graph grant. AZURE_CLIENT_ID makes DefaultAzureCredential
// (Key Vault, Web PubSub, SQL) use it. The database connection is SQL_SERVER_FQDN + SQL_DATABASE; the
// poller holds no database password. The web app keeps DATABASE_URL (infra/README.md).
//
// The package itself is deployed by infra/deploy.sh (zip, SCM_DO_BUILD_DURING_DEPLOYMENT=false,
// APP_VERSION). The settings it writes survive a Bicep redeploy: functionapp/appsettings.bicep merges
// Bicep's settings into the live ones instead of replacing the list.
//
// AzureWebJobsStorage carries the storage account key on purpose: the Functions host on a Linux
// Consumption plan needs a key-based connection for its own storage (run-from-package, timers,
// locks). It is the one secret that does not go through Key Vault; the key never leaves Azure
// (ARM resolves listKeys() at deployment time) and the storage account holds nothing but the host's
// own files. Everything the application reads is a Key Vault reference.

param location string
param tags object
@minLength(3)
param baseName string
param suffix string
param keyVaultUri string
param webPubSubHostName string
param webPubSubHub string
param appInsightsConnectionString string
@description('Fully qualified host name of the SQL server the poller connects to as its identity.')
param sqlServerFqdn string
@description('Name of the database the poller connects to.')
param sqlDatabase string

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-${baseName}-${suffix}'
  location: location
  tags: tags
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: 'st${baseName}${suffix}'
  location: location
  tags: tags
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    // The Consumption plan's host still needs a key-based AzureWebJobsStorage connection.
    allowSharedKeyAccess: true
    accessTier: 'Hot'
  }
}

resource plan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: 'plan-${baseName}-${suffix}'
  location: location
  tags: tags
  kind: 'functionapp'
  sku: {
    name: 'Y1'
    tier: 'Dynamic'
  }
  properties: {
    reserved: true
  }
}

// Bicep's own settings. Not on the site resource: see functionapp/appsettings.bicep.
var appSettings = {
  AzureWebJobsStorage: 'DefaultEndpointsProtocol=https;AccountName=${storage.name};EndpointSuffix=${environment().suffixes.storage};AccountKey=${storage.listKeys().keys[0].value}'
  FUNCTIONS_EXTENSION_VERSION: '~4'
  FUNCTIONS_WORKER_RUNTIME: 'node'
  SCM_DO_BUILD_DURING_DEPLOYMENT: 'false'
  APPLICATIONINSIGHTS_CONNECTION_STRING: appInsightsConnectionString
  AZURE_CLIENT_ID: identity.properties.clientId
  SQL_SERVER_FQDN: sqlServerFqdn
  SQL_DATABASE: sqlDatabase
  WEB_PUBSUB_ENDPOINT: 'https://${webPubSubHostName}'
  WEB_PUBSUB_HUB: webPubSubHub
  KEY_VAULT_URL: keyVaultUri
}

resource functionApp 'Microsoft.Web/sites@2024-04-01' = {
  name: '${baseName}-poller-${suffix}'
  location: location
  tags: tags
  kind: 'functionapp,linux'
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identity.id}': {}
    }
  }
  properties: {
    serverFarmId: plan.id
    reserved: true
    httpsOnly: true
    keyVaultReferenceIdentity: identity.id
    siteConfig: {
      linuxFxVersion: 'Node|22'
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      http20Enabled: true
    }
  }
}

resource currentSettings 'Microsoft.Web/sites/config@2024-04-01' existing = {
  parent: functionApp
  name: 'appsettings'
}

module settings 'functionapp/appsettings.bicep' = {
  name: 'functionapp-appsettings'
  params: {
    functionAppName: functionApp.name
    currentAppSettings: currentSettings.list().properties
    appSettings: appSettings
  }
}

output name string = functionApp.name
output identityName string = identity.name
output principalId string = identity.properties.principalId
output clientId string = identity.properties.clientId
output defaultHostName string = functionApp.properties.defaultHostName

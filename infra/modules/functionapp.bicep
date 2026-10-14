// The poller: a Function App on a Linux Consumption (Y1) plan, Node 22, with its own storage
// account (spec section 1, plan section 7). Secrets reach it as Key Vault references resolved by
// its system-assigned identity; nothing secret is in this file or in the deployment history.
//
// The package itself is deployed by infra/deploy.sh (zip, SCM_DO_BUILD_DURING_DEPLOYMENT=false,
// APP_VERSION), which also restores the settings a Bicep redeploy replaces.

param location string
param tags object
@minLength(3)
param baseName string
param suffix string
param keyVaultUri string
param webPubSubHostName string
param webPubSubHub string
param appInsightsConnectionString string

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

resource functionApp 'Microsoft.Web/sites@2024-04-01' = {
  name: '${baseName}-poller-${suffix}'
  location: location
  tags: tags
  kind: 'functionapp,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: plan.id
    reserved: true
    httpsOnly: true
    keyVaultReferenceIdentity: 'SystemAssigned'
    siteConfig: {
      linuxFxVersion: 'Node|22'
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      http20Enabled: true
      appSettings: [
        {
          name: 'AzureWebJobsStorage'
          value: 'DefaultEndpointsProtocol=https;AccountName=${storage.name};EndpointSuffix=${environment().suffixes.storage};AccountKey=${storage.listKeys().keys[0].value}'
        }
        {
          name: 'FUNCTIONS_EXTENSION_VERSION'
          value: '~4'
        }
        {
          name: 'FUNCTIONS_WORKER_RUNTIME'
          value: 'node'
        }
        {
          name: 'SCM_DO_BUILD_DURING_DEPLOYMENT'
          value: 'false'
        }
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: appInsightsConnectionString
        }
        {
          name: 'DATABASE_URL'
          value: '@Microsoft.KeyVault(SecretUri=${keyVaultUri}secrets/database-url/)'
        }
        {
          name: 'WEB_PUBSUB_ENDPOINT'
          value: 'https://${webPubSubHostName}'
        }
        {
          name: 'WEB_PUBSUB_HUB'
          value: webPubSubHub
        }
        {
          name: 'KEY_VAULT_URL'
          value: keyVaultUri
        }
      ]
    }
  }
}

output name string = functionApp.name
output principalId string = functionApp.identity.principalId
output defaultHostName string = functionApp.properties.defaultHostName

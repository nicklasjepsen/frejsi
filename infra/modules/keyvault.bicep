// Key Vault (RBAC) holding every secret the product needs (plan section 7):
//   database-url, web-pubsub-connection-string   created once by infra/deploy.sh if absent
//   bootstrap-token                               written here from a newGuid() parameter; may rotate
//   glucose-<spaceId>                             written by the Function App's source-connect trigger
// The deploy principal gets Key Vault Secrets Officer here (not in roles.bicep) because the
// bootstrap-token secret below depends on that assignment existing first.

param location string
param tags object
param baseName string
param suffix string

@secure()
param bootstrapToken string

// Built-in role: Key Vault Secrets Officer.
var keyVaultSecretsOfficer = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'b86a8fe4-44ce-4948-aee5-eccb2c155cd7')

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: 'kv-${baseName}-${suffix}'
  location: location
  tags: tags
  properties: {
    tenantId: tenant().tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    publicNetworkAccess: 'Enabled'
  }
}

// The pipeline's identity: reads and writes secrets in deploy.sh and writes bootstrap-token below.
resource deployerSecretsOfficer 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(vault.id, deployer().objectId, keyVaultSecretsOfficer)
  scope: vault
  properties: {
    roleDefinitionId: keyVaultSecretsOfficer
    principalId: deployer().objectId
    principalType: 'ServicePrincipal'
  }
}

resource bootstrapTokenSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: vault
  name: 'bootstrap-token'
  tags: tags
  properties: {
    value: bootstrapToken
    contentType: 'text/plain'
  }
  dependsOn: [
    deployerSecretsOfficer
  ]
}

output vaultName string = vault.name
output vaultId string = vault.id
output vaultUri string = vault.properties.vaultUri

// Role assignments for the Function App's managed identity (spec sections 3, 3b; plan section 7):
//   Key Vault Secrets Officer  it writes glucose-<spaceId> from source-connect and reads database-url
//   Web PubSub Service Owner   it publishes readings without a key
// The deploy principal's Key Vault role lives in keyvault.bicep next to the secret that needs it.

param keyVaultName string
param webPubSubName string
param functionAppPrincipalId string

var keyVaultSecretsOfficer = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'b86a8fe4-44ce-4948-aee5-eccb2c155cd7')
var webPubSubServiceOwner = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '12cf5a90-567b-43ae-8102-96cf46c7d9b4')

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' existing = {
  name: keyVaultName
}

resource webPubSub 'Microsoft.SignalRService/webPubSub@2024-03-01' existing = {
  name: webPubSubName
}

resource functionSecretsOfficer 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(vault.id, functionAppPrincipalId, keyVaultSecretsOfficer)
  scope: vault
  properties: {
    roleDefinitionId: keyVaultSecretsOfficer
    principalId: functionAppPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource functionWebPubSubOwner 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(webPubSub.id, functionAppPrincipalId, webPubSubServiceOwner)
  scope: webPubSub
  properties: {
    roleDefinitionId: webPubSubServiceOwner
    principalId: functionAppPrincipalId
    principalType: 'ServicePrincipal'
  }
}

targetScope = 'resourceGroup'

param location string = resourceGroup().location
@minLength(3)
@maxLength(7)
param baseName string = 'frejsi'
param suffix string = uniqueString(resourceGroup().id)
param tags object = {
  project: 'frejsi'
}

resource account 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: 'stp${baseName}${suffix}'
  location: location
  tags: union(tags, { purpose: 'photos' })
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  properties: {
    allowBlobPublicAccess: false
    allowCrossTenantReplication: false
    allowSharedKeyAccess: true
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}
resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: account
  name: 'default'
  properties: {
    deleteRetentionPolicy: {
      enabled: true
      days: 7
    }
  }
}
resource photos 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'photos'
  properties: { publicAccess: 'None' }
}
output accountName string = account.name
output blobEndpoint string = account.properties.primaryEndpoints.blob

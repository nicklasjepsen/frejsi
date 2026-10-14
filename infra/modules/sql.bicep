// Azure SQL logical server with a Basic (5 DTU) database (spec section 1: not serverless, because the
// five-minute poller would never let it pause).
//
// Authentication (plan decision 11): the deploy principal is the server's Entra admin, so
// infra/deploy.sh can create the application's SQL login with a password it generates once and
// stores in Key Vault. Bicep never holds a password: the server is created Entra-only (which lets
// the SQL admin login be omitted) and the child resource below turns SQL authentication back on.

param location string
param tags object
param baseName string
param suffix string
param databaseName string = 'frejsi'

@description('Display name of the Entra admin; the identity is the deployment principal.')
param entraAdminLogin string = 'frejsi-deploy'

resource server 'Microsoft.Sql/servers@2023-08-01' = {
  name: 'sql-${baseName}-${suffix}'
  location: location
  tags: tags
  properties: {
    version: '12.0'
    minimalTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
    administrators: {
      administratorType: 'ActiveDirectory'
      principalType: 'Application'
      login: entraAdminLogin
      sid: deployer().objectId
      tenantId: deployer().tenantId
      azureADOnlyAuthentication: true
    }
  }
}

// SQL authentication on, for the application login deploy.sh creates (Prisma has no Entra auth).
resource sqlAuthentication 'Microsoft.Sql/servers/azureADOnlyAuthentications@2023-08-01' = {
  parent: server
  name: 'Default'
  properties: {
    azureADOnlyAuthentication: false
  }
}

// "Allow Azure services and resources to access this server": the Function App and the Static Web
// App's managed backend have no fixed IP. The pipeline runner gets a temporary rule from deploy.sh.
resource allowAzureServices 'Microsoft.Sql/servers/firewallRules@2023-08-01' = {
  parent: server
  name: 'AllowAllWindowsAzureIps'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

resource database 'Microsoft.Sql/servers/databases@2023-08-01' = {
  parent: server
  name: databaseName
  location: location
  tags: tags
  sku: {
    name: 'Basic'
    tier: 'Basic'
    capacity: 5
  }
  properties: {
    collation: 'SQL_Latin1_General_CP1_CI_AS'
    maxSizeBytes: 2147483648
    zoneRedundant: false
    requestedBackupStorageRedundancy: 'Local'
  }
}

output serverName string = server.name
output serverFqdn string = server.properties.fullyQualifiedDomainName
output databaseName string = database.name

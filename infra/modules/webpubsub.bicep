// Azure Web PubSub, Free tier, one hub (spec section 3b). The poller publishes with its managed
// identity (Web PubSub Service Owner, see roles.bicep); the web app uses the connection string that
// deploy.sh stores in Key Vault once. Groups per space are created by the clients' tokens, not here.

param location string
param tags object
param baseName string
param suffix string
param hubName string

resource webPubSub 'Microsoft.SignalRService/webPubSub@2024-03-01' = {
  name: 'wps-${baseName}-${suffix}'
  location: location
  tags: tags
  sku: {
    name: 'Free_F1'
    tier: 'Free'
    capacity: 1
  }
  properties: {
    publicNetworkAccess: 'Enabled'
    disableLocalAuth: false
    disableAadAuth: false
    tls: {
      clientCertEnabled: false
    }
  }
}

resource hub 'Microsoft.SignalRService/webPubSub/hubs@2024-03-01' = {
  parent: webPubSub
  name: hubName
  properties: {
    anonymousConnectPolicy: 'deny'
    eventHandlers: []
  }
}

output name string = webPubSub.name
output id string = webPubSub.id
output hostName string = webPubSub.properties.hostName
output hubName string = hub.name

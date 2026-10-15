// Azure Web PubSub, Free tier, one hub (spec section 3b). The poller publishes with its managed
// identity (Web PubSub Service Owner, see roles.bicep); the web app uses the connection string that
// deploy.sh stores in Key Vault once.
//
// Groups are granted when a socket connects, never by the client's token (issue #95): the hub calls
// the web app's /api/pubsub on every `connect`, and the app answers with the groups the member's
// current role allows. That event handler is registered by deploy.sh (step 7), not here: Azure
// validates a handler with an OPTIONS request when it is set, so it can only be set once the web
// app that answers it is deployed, which is after this template on every release and on the first
// one does not exist at all. A release that applies this template therefore clears the handler
// until deploy.sh sets it again minutes later (infra/README.md, "Live groups and the connect handler").

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

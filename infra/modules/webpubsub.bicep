// Azure Web PubSub, Free tier, one hub (spec section 3b). The poller publishes with its managed
// identity (Web PubSub Service Owner, see roles.bicep); the web app uses the connection string that
// deploy.sh stores in Key Vault once.
//
// Groups are granted when a socket connects, never by the client's token (issue #95): the hub calls
// the web app's /api/pubsub on every `connect`, and the app answers with the groups the member's
// current role allows. Handler authentication: CloudEvents abuse protection (the app allows only
// this service's origin) plus the `ce-signature` header, an HMAC of the connection id under the
// hub's access key, which the app checks with the key in its connection string. That key is the
// shared key, already in Key Vault (web-pubsub-connection-string), so no new secret and no Entra
// app registration: the managed-identity option needs one for the token's audience, and a Static
// Web App cannot validate that token without one either (infra/README.md).

param location string
param tags object
param baseName string
param suffix string
param hubName string

@description('Host of the web app that handles the hub\'s connect event at /api/pubsub. Empty means no handler (sockets then join no group).')
param eventHandlerHost string = ''

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
    // Only the blocking `connect` event: no user events (the clients send nothing) and no
    // connected/disconnected calls the app would only have to answer.
    eventHandlers: empty(eventHandlerHost)
      ? []
      : [
          {
            urlTemplate: 'https://${eventHandlerHost}/api/pubsub'
            systemEvents: [
              'connect'
            ]
            auth: {
              type: 'None'
            }
          }
        ]
  }
}

output name string = webPubSub.name
output id string = webPubSub.id
output hostName string = webPubSub.properties.hostName
output hubName string = hub.name

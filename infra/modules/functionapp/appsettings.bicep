// The Function App's app settings, merged into what is already there.
//
// `Microsoft.Web/sites/config` named `appsettings` replaces the complete set, so the live settings
// (WEBSITE_RUN_FROM_PACKAGE, APP_VERSION and ENABLE_ORYX_BUILD, written by infra/deploy.sh) are read
// with list() by the parent module and passed in here: `union()` keeps them and lets Bicep's own
// values win. Without this, every infra deploy would leave the poller without a package until the
// deploy job's zip step, minutes later or never if that job fails first.
//
// This is a module and not a resource in functionapp.bicep because list() must run after the site
// exists; as a module parameter it is evaluated when this deployment starts, after the site.

param functionAppName string

@description('The settings the Function App has right now (list(...).properties); empty on first create.')
@secure()
param currentAppSettings object

@description('The settings Bicep owns. They win over the current ones.')
@secure()
param appSettings object

resource functionApp 'Microsoft.Web/sites@2024-04-01' existing = {
  name: functionAppName
}

resource settings 'Microsoft.Web/sites/config@2024-04-01' = {
  parent: functionApp
  name: 'appsettings'
  properties: union(currentAppSettings, appSettings)
}

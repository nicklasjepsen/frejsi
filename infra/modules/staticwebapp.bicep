// The web app: Azure Static Web Apps, Standard plan, hybrid Next.js (spec section 1).
// No identity providers are configured and web/staticwebapp.config.json carries no `auth` block:
// Frejsi signs people in with passkeys (spec section 2b). App settings are written by infra/deploy.sh.
//
// The custom domain is created only when `customDomain` is set, because CNAME validation needs the
// site's default hostname to exist in DNS first (infra/README.md, owner step 7).

param location string
param tags object
param baseName string
param suffix string
param customDomain string

// The suffix keeps the name unique across installations, like every other public-facing resource:
// a fork that keeps baseName would otherwise fail its first deployment on a taken name.
resource site 'Microsoft.Web/staticSites@2024-04-01' = {
  name: '${baseName}-${suffix}'
  location: location
  tags: tags
  sku: {
    name: 'Standard'
    tier: 'Standard'
  }
  properties: {
    stagingEnvironmentPolicy: 'Enabled'
    allowConfigFileUpdates: true
    enterpriseGradeCdnStatus: 'Disabled'
  }
}

resource domain 'Microsoft.Web/staticSites/customDomains@2024-04-01' = if (!empty(customDomain)) {
  parent: site
  name: customDomain
  properties: {
    validationMethod: 'cname-delegation'
  }
}

output name string = site.name
output id string = site.id
output defaultHostname string = site.properties.defaultHostname

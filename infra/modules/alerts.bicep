// The one alert the spec asks for (section 7, plan decision 21): no `reading.stored` custom event
// in 35 minutes. Sensor changes cause gaps of about 30 minutes, so 35 is the first value that means
// something is wrong in the chain Dexcom -> poller -> database. The address is the `alertEmail`
// parameter, passed from the ALERT_EMAIL repository variable; it is never in the repository.

param location string
param tags object
param baseName string
param appInsightsId string
param alertEmail string

resource actionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: 'ag-${baseName}-owner'
  location: 'global'
  tags: tags
  properties: {
    groupShortName: 'frejsi'
    enabled: true
    emailReceivers: [
      {
        name: 'owner'
        emailAddress: alertEmail
        useCommonAlertSchema: true
      }
    ]
  }
}

resource noReadings 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: 'alert-${baseName}-no-readings'
  location: location
  tags: tags
  kind: 'LogAlert'
  properties: {
    displayName: 'Frejsi: no glucose reading stored for 35 minutes'
    description: 'The poller has not stored a reading in 35 minutes. Check the source status in Settings, then the poller log. See docs/operations.md.'
    severity: 2
    enabled: true
    evaluationFrequency: 'PT5M'
    windowSize: 'PT35M'
    scopes: [
      appInsightsId
    ]
    criteria: {
      allOf: [
        {
          query: 'customEvents | where name == "reading.stored"'
          timeAggregation: 'Count'
          operator: 'LessThan'
          threshold: 1
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    autoMitigate: true
    actions: {
      actionGroups: [
        actionGroup.id
      ]
    }
  }
}

output actionGroupId string = actionGroup.id
output alertRuleName string = noReadings.name

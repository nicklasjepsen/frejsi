// Acceptance tests for infra/main.bicep (issue #13), run over the built ARM JSON.
// `node --test infra/test/` — needs the bicep CLI and shellcheck on PATH (infra-check.yml installs them).
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { bicepBin, buildMain, infraDir, repoRoot, resolve, run, walkResources, readIfExists } from './helpers.mjs';

const template = buildMain();
const all = [...walkResources(template)];
const byType = (t) => all.filter((r) => r.resource.type.toLowerCase() === t.toLowerCase());
const props = (r) => resolve(r.resource.properties ?? {}, r.scope);

// Resource types that have no `tags` property in ARM. Everything else must carry project=frejsi.
const UNTAGGABLE = new Set(
  [
    'Microsoft.Authorization/roleAssignments',
    'Microsoft.Sql/servers/firewallRules',
    'Microsoft.Sql/servers/azureADOnlyAuthentications',
    'Microsoft.Sql/servers/administrators',
    'Microsoft.SignalRService/webPubSub/hubs',
    'Microsoft.Web/staticSites/customDomains',
    'Microsoft.Web/sites/config',
    'Microsoft.Storage/storageAccounts/blobServices',
    'Microsoft.Storage/storageAccounts/blobServices/containers',
  ].map((t) => t.toLowerCase()),
);

test('bicep build, lint and build-params succeed with no warnings', () => {
  const bicep = bicepBin();
  const build = run(bicep, ['build', path.join(infraDir, 'main.bicep'), '--stdout']);
  assert.equal(build.status, 0, build.stderr);
  assert.doesNotMatch(build.stderr, /warning|error/i, build.stderr);

  const lint = run(bicep, ['lint', path.join(infraDir, 'main.bicep')]);
  assert.equal(lint.status, 0, lint.stderr);
  assert.doesNotMatch(lint.stderr + lint.stdout, /warning|error/i, lint.stderr + lint.stdout);

  const params = run(bicep, ['build-params', path.join(infraDir, 'main.bicepparam'), '--stdout'], {
    env: { ...process.env, ALERT_EMAIL: 'alerts@example.invalid', CUSTOM_DOMAIN: '', SQL_SERVER_ID: '' },
  });
  assert.equal(params.status, 0, params.stderr);
  assert.doesNotMatch(params.stderr, /warning|error/i, params.stderr);
  const parsed = JSON.parse(params.stdout);
  const values = parsed.parametersJson ? JSON.parse(parsed.parametersJson) : parsed;
  assert.equal(values.parameters.alertEmail.value, 'alerts@example.invalid');
  assert.equal(values.parameters.sqlServerId.value, '');
});

test('an existing SQL server: SQL_SERVER_ID reaches sqlServerId and the dedicated server module is skipped', () => {
  const id = '/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/shared-rg/providers/Microsoft.Sql/servers/shared-sql';
  const params = run(bicepBin(), ['build-params', path.join(infraDir, 'main.bicepparam'), '--stdout'], {
    env: { ...process.env, ALERT_EMAIL: 'alerts@example.invalid', CUSTOM_DOMAIN: '', SQL_SERVER_ID: id },
  });
  assert.equal(params.status, 0, params.stderr);
  const parsed = JSON.parse(params.stdout);
  const values = parsed.parametersJson ? JSON.parse(parsed.parametersJson) : parsed;
  assert.equal(values.parameters.sqlServerId.value, id);
  assert.equal(template.parameters.sqlServerId.defaultValue, '', 'a dedicated server unless the variable is set');
  const list = Array.isArray(template.resources) ? template.resources : Object.values(template.resources);
  const sqlModule = list.find((r) => r.type === 'Microsoft.Resources/deployments' && r.name === 'sql');
  assert.ok(sqlModule, 'no sql module');
  assert.equal(sqlModule.condition, "[empty(parameters('sqlServerId'))]");
  // Nothing in the template targets another resource group: the shared server is never deployed to.
  assert.ok(!list.some((r) => r.resourceGroup), 'a module deploys outside the resource group');
});

test('baseName is bounded so every generated name fits its Azure limit', () => {
  const max = template.parameters.baseName.maxLength;
  assert.ok(max <= 7, `kv-<baseName>-<13-char suffix> must fit Key Vault's 24 characters; maxLength is ${max}`);
  assert.ok(template.parameters.baseName.minLength >= 3);
});

test('main.bicep is a module list: parameters, modules and outputs only, no resources', () => {
  const src = readFileSync(path.join(infraDir, 'main.bicep'), 'utf8');
  assert.doesNotMatch(src, /^\s*resource\s/m, 'main.bicep declares a resource; put it in modules/');
  assert.ok((src.match(/^module\s/gm) ?? []).length >= 7, 'expected at least seven modules');
  // Top-level module files are listed in main.bicep; a file in a subdirectory belongs to the module
  // of the same name (modules/functionapp/appsettings.bicep is functionapp.bicep's).
  const modulesDir = path.join(infraDir, 'modules');
  const files = readdirSync(modulesDir).filter((f) => f.endsWith('.bicep'));
  for (const f of files) assert.match(src, new RegExp(`modules/${f.replace('.', '\\.')}`), `${f} is not in main.bicep`);
});

test('every taggable resource carries project=frejsi', () => {
  assert.ok(all.length > 10, 'expected a real template');
  for (const r of all) {
    if (UNTAGGABLE.has(r.resource.type.toLowerCase())) continue;
    const tags = resolve(r.resource.tags, r.scope);
    assert.ok(tags && typeof tags === 'object', `${r.modulePath} ${r.resource.type} ${r.resource.name}: no tags`);
    assert.equal(tags.project, 'frejsi', `${r.modulePath} ${r.resource.type} ${r.resource.name}: tags=${JSON.stringify(tags)}`);
  }
});

test('Static Web App Standard with the custom domain and no identity providers', () => {
  const [swa] = byType('Microsoft.Web/staticSites');
  assert.ok(swa, 'no static site');
  assert.equal(resolve(swa.resource.sku, swa.scope).name, 'Standard');
  // Globally unique like the other public-facing names: a fork that keeps baseName must not collide.
  assert.match(resolve(swa.resource.name, swa.scope), /^frejsi-\[uniqueString\(resourceGroup\(\)\.id\)\]$/);
  const domains = byType('Microsoft.Web/staticSites/customDomains');
  assert.equal(domains.length, 1, 'expected one (conditional) custom domain resource');
  assert.ok(domains[0].resource.condition, 'custom domain must be conditional on the domain parameter');
  assert.equal(byType('Microsoft.Web/staticSites/config').length, 0, 'no auth/identity provider config on the SWA');
  const config = readIfExists(path.join(repoRoot, 'web/staticwebapp.config.json'));
  if (config) assert.ok(!('auth' in JSON.parse(config)), 'staticwebapp.config.json must not have an auth block');
});

test('Function App: Linux Consumption Y1, Node 22, its own storage account, settings from outputs', () => {
  const [plan] = byType('Microsoft.Web/serverfarms');
  assert.equal(resolve(plan.resource.sku, plan.scope).name, 'Y1');
  assert.equal(resolve(plan.resource.properties, plan.scope).reserved, true);
  const [app] = byType('Microsoft.Web/sites');
  assert.match(resolve(app.resource.kind, app.scope), /functionapp,linux/);
  const p = props(app);
  assert.equal(p.siteConfig.linuxFxVersion, 'Node|22');
  assert.equal(resolve(app.resource.identity, app.scope).type, 'SystemAssigned');
  const settings = functionAppSettings();
  assert.match(settings.DATABASE_URL, /^@Microsoft\.KeyVault\(SecretUri=.*database-url/);
  // Outputs of the webpubsub and keyvault modules, never a hard-coded host.
  assert.match(settings.WEB_PUBSUB_ENDPOINT, /^https:\/\/\[reference\(.*'webpubsub'.*hostName/);
  assert.match(settings.WEB_PUBSUB_HUB, /^\[reference\(.*'webpubsub'.*hubName/);
  assert.match(settings.KEY_VAULT_URL, /^\[reference\(.*'keyvault'.*vaultUri/);
  assert.ok(settings.APPLICATIONINSIGHTS_CONNECTION_STRING, 'APPLICATIONINSIGHTS_CONNECTION_STRING missing');
  assert.equal(settings.FUNCTIONS_WORKER_RUNTIME, 'node');
  assert.ok(!('APP_VERSION' in settings), 'APP_VERSION is set by deploy.sh, not Bicep');
  const accounts = byType('Microsoft.Storage/storageAccounts');
  assert.equal(accounts.length, 2, 'dedicated accounts for the poller and photos');
  const pollerAccount = accounts.find((r) => r.modulePath.includes('functionapp'));
  assert.ok(pollerAccount, 'the poller keeps its own storage account');
  assert.match(settings.AzureWebJobsStorage, /listKeys/);
});

test('a Bicep redeploy keeps the settings deploy.sh wrote (WEBSITE_RUN_FROM_PACKAGE, APP_VERSION)', () => {
  // The site resource carries no appSettings list: a list there is the complete set and a redeploy
  // would drop the package URL, leaving the poller without code until deploy.sh runs again.
  const [app] = byType('Microsoft.Web/sites');
  assert.ok(!('appSettings' in (app.resource.properties.siteConfig ?? {})), 'siteConfig.appSettings replaces every setting on redeploy');
  // Instead a config/appsettings resource merges the live settings with Bicep's own.
  const config = byType('Microsoft.Web/sites/config').find((r) => /appsettings/.test(resolve(r.resource.name, r.scope)));
  assert.ok(config, 'no Microsoft.Web/sites/config appsettings resource');
  assert.match(config.resource.properties, /^\[union\(parameters\('currentAppSettings'\), ?parameters\('appSettings'\)\)\]$/);
  assert.match(config.scope.paramValues.currentAppSettings, /^\[list\(.*appsettings.*\)\.properties\]$/);
  // Both parameters hold the storage key, so neither may land in the deployment history.
  assert.equal(config.scope.template.parameters.currentAppSettings.type, 'secureObject');
  assert.equal(config.scope.template.parameters.appSettings.type, 'secureObject');
});

/** The Function App's own settings: the appSettings parameter of the appsettings module, resolved. */
function functionAppSettings() {
  const config = byType('Microsoft.Web/sites/config').find((r) => /appsettings/.test(resolve(r.resource.name, r.scope)));
  assert.ok(config, 'no Microsoft.Web/sites/config appsettings resource');
  const settings = resolve(config.scope.paramValues.appSettings, config.scope.parent);
  assert.equal(typeof settings, 'object', `appSettings did not resolve to an object: ${settings}`);
  return settings;
}

test('Azure SQL: Entra admin is the deployer, Basic 5 DTU, Allow Azure services, no password in Bicep', () => {
  const [server] = byType('Microsoft.Sql/servers');
  const p = props(server);
  assert.equal(p.administrators.administratorType, 'ActiveDirectory');
  assert.match(server.resource.properties.administrators.sid, /deployer\(\)\.objectId/);
  assert.ok(!('administratorLoginPassword' in p), 'no SQL admin password in Bicep');
  // The server body's `administrators` counts only at create time (ARM reference); the child
  // resource is the supported update path, so a changed deploy principal is applied on redeploy.
  const [admin] = byType('Microsoft.Sql/servers/administrators');
  assert.ok(admin, 'no Microsoft.Sql/servers/administrators child resource');
  assert.match(resolve(admin.resource.name, admin.scope), /ActiveDirectory/);
  assert.match(admin.resource.properties.sid, /deployer\(\)\.objectId/);
  assert.equal(admin.resource.properties.administratorType, 'ActiveDirectory');
  const adOnly = byType('Microsoft.Sql/servers/azureADOnlyAuthentications');
  assert.equal(adOnly.length, 1);
  assert.equal(props(adOnly[0]).azureADOnlyAuthentication, false, 'SQL auth must be allowed for the app login');
  const [db] = byType('Microsoft.Sql/servers/databases');
  const sku = resolve(db.resource.sku, db.scope);
  assert.equal(sku.name, 'Basic');
  assert.equal(sku.capacity, 5);
  const rules = byType('Microsoft.Sql/servers/firewallRules').map(props);
  assert.ok(rules.some((r) => r.startIpAddress === '0.0.0.0' && r.endIpAddress === '0.0.0.0'), 'Allow Azure services rule');
});

test('Web PubSub Free with hub frejsi; Key Vault RBAC; Log Analytics + App Insights', () => {
  const [wps] = byType('Microsoft.SignalRService/webPubSub');
  assert.equal(resolve(wps.resource.sku, wps.scope).name, 'Free_F1');
  const hubs = byType('Microsoft.SignalRService/webPubSub/hubs');
  assert.equal(hubs.length, 1);
  assert.match(resolve(hubs[0].resource.name, hubs[0].scope), /\/frejsi|'frejsi'/);
  const [kv] = byType('Microsoft.KeyVault/vaults');
  assert.equal(props(kv).enableRbacAuthorization, true);
  assert.equal(byType('Microsoft.OperationalInsights/workspaces').length, 1);
  assert.equal(byType('Microsoft.Insights/components').length, 1);
});

test('roles: Function identity gets KV Secrets Officer and Web PubSub Service Owner; deployer gets KV Secrets Officer', () => {
  // Public Azure built-in role definition IDs (the ARM reference lists them); not secrets.
  const VAULT_OFFICER_ROLE = 'b86a8fe4-44ce-4948-aee5-eccb2c155cd7';
  const WPS_OWNER_ROLE = '12cf5a90-567b-43ae-8102-96cf46c7d9b4';
  const assignments = byType('Microsoft.Authorization/roleAssignments').map((r) => ({
    role: resolve(r.resource.properties.roleDefinitionId, r.scope),
    principal: r.resource.properties.principalId,
    scope: r.resource.scope ?? '',
  }));
  const withRole = (id) => assignments.filter((a) => a.role.includes(id));
  const kvOfficers = withRole(VAULT_OFFICER_ROLE);
  assert.equal(kvOfficers.length, 2, JSON.stringify(assignments, null, 2));
  assert.ok(kvOfficers.some((a) => /deployer\(\)\.objectId/.test(a.principal)), 'deploy principal is KV Secrets Officer');
  assert.ok(kvOfficers.some((a) => !/deployer\(\)/.test(a.principal)), 'function identity is KV Secrets Officer');
  const wps = withRole(WPS_OWNER_ROLE);
  assert.equal(wps.length, 1);
  assert.ok(!/deployer\(\)/.test(wps[0].principal), 'Web PubSub Service Owner goes to the function identity');
});

test('bootstrap-token is a newGuid() parameter default; no other secret is generated by Bicep', () => {
  const param = template.parameters.bootstrapToken;
  assert.ok(param, 'bootstrapToken parameter');
  assert.equal(param.defaultValue, '[newGuid()]');
  const secrets = byType('Microsoft.KeyVault/vaults/secrets');
  assert.equal(secrets.length, 1, 'only bootstrap-token is written by Bicep');
  assert.match(resolve(secrets[0].resource.name, secrets[0].scope), /bootstrap-token/);
  const src = allBicepSource();
  assert.equal((src.match(/newGuid\(\)/g) ?? []).length, 1, 'newGuid() appears once, for bootstrap-token');
});

test('alert: no reading.stored for 35 minutes, to an action group with the alertEmail parameter', () => {
  const [rule] = byType('Microsoft.Insights/scheduledQueryRules');
  const p = props(rule);
  // Azure Monitor accepts only fixed window sizes; the 35 minutes live in the query.
  assert.ok(['PT45M', 'PT1H'].includes(p.windowSize), `unsupported windowSize ${p.windowSize}`);
  assert.equal(p.evaluationFrequency, 'PT5M');
  const crit = p.criteria.allOf[0];
  assert.match(crit.query, /customEvents/);
  assert.match(crit.query, /ago\(35m\)/);
  assert.match(crit.query, /reading\.stored/);
  assert.equal(crit.operator, 'LessThan');
  assert.equal(crit.threshold, 1);
  assert.equal(crit.timeAggregation, 'Count');
  const [group] = byType('Microsoft.Insights/actionGroups');
  const email = group.resource.properties.emailReceivers[0].emailAddress;
  assert.match(email, /parameters\('alertEmail'\)/);
  assert.equal(template.parameters.alertEmail.defaultValue, undefined, 'alertEmail has no default');
  // Secure in main and in the module, so the address stays out of the deployment history.
  assert.equal(template.parameters.alertEmail.type.toLowerCase(), 'securestring');
  assert.equal(group.scope.template.parameters.alertEmail.type.toLowerCase(), 'securestring');
});

test('no email address, secret or real person in infra/ or the workflows', () => {
  const files = [...listFiles(infraDir), ...listFiles(path.join(repoRoot, '.github/workflows'))];
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    const emails = (text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) ?? []).filter((e) => !/example\.invalid$/.test(e));
    assert.deepEqual(emails, [], `${path.relative(repoRoot, f)} contains an address`);
    assert.doesNotMatch(text, /(password|secret|token)\s*[=:]\s*['"][^'"$@{]{8,}['"]/i, `${f}: literal secret`);
  }
});

test('deploy.sh is shellcheck-clean', () => {
  const r = run('shellcheck', ['-S', 'style', path.join(infraDir, 'deploy.sh')]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

function allBicepSource() {
  return [...listFiles(infraDir)]
    .filter((f) => f.endsWith('.bicep'))
    .map((f) => readFileSync(f, 'utf8').replace(/^\s*\/\/.*$/gm, ''))
    .join('\n');
}

function* listFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) yield* listFiles(p);
    else yield p;
  }
}


test('photos have a dedicated private Standard LRS account, seven-day soft delete and a safe output', () => {
  const account = byType('Microsoft.Storage/storageAccounts').find((r) => r.modulePath.includes('photos'));
  assert.ok(account, 'photo account is wired into main');
  assert.equal(resolve(account.resource.sku, account.scope).name, 'Standard_LRS');
  assert.equal(resolve(account.resource.tags, account.scope).purpose, 'photos');
  const p = props(account);
  assert.equal(p.allowBlobPublicAccess, false);
  assert.equal(p.supportsHttpsTrafficOnly, true);
  assert.equal(p.minimumTlsVersion, 'TLS1_2');
  const [service] = byType('Microsoft.Storage/storageAccounts/blobServices');
  assert.equal(props(service).deleteRetentionPolicy.enabled, true);
  assert.equal(props(service).deleteRetentionPolicy.days, 7);
  const [container] = byType('Microsoft.Storage/storageAccounts/blobServices/containers');
  assert.match(resolve(container.resource.name, container.scope), /photos/);
  assert.equal(props(container).publicAccess, 'None');
  assert.ok(template.outputs.photosStorageAccountName);
  assert.doesNotMatch(JSON.stringify(template.outputs), /listKeys|AccountKey|connectionString/i);
});

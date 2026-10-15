// Acceptance tests for infra/deploy.sh (issue #13). The script runs against fake `az`, `sqlcmd`,
// `pnpm`, `docker` and `curl` from ./fakes, which log every call; no Azure is touched.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { infraDir } from './helpers.mjs';

const fakesDir = path.join(infraDir, 'test/fakes');
const deploySh = path.join(infraDir, 'deploy.sh');

const SECRET_MARKERS = ['FAKEDBPASSWORD', 'FAKEWPSKEY', 'FAKEBOOTSTRAPTOKEN', 'FAKEFUNCTIONKEY', 'FAKESWATOKEN', 'FAKESAS'];

function runDeploy({ env = {}, omit = [], rootServer = true } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'frejsi-deploy-'));
  // A pretend checkout: the poller bundle and the standalone web build the release job provides.
  mkdirSync(path.join(dir, 'repo/poller/dist'), { recursive: true });
  writeFileSync(path.join(dir, 'repo/poller/dist/index.js'), 'module.exports = {};\n');
  mkdirSync(path.join(dir, 'repo/web/.next/standalone'), { recursive: true });
  if (rootServer) writeFileSync(path.join(dir, 'repo/web/.next/standalone/server.js'), '// built\n');
  const logDir = path.join(dir, 'log');
  mkdirSync(logDir);
  const log = path.join(logDir, 'calls.log');
  writeFileSync(log, '');
  const githubOutput = path.join(dir, 'github-output');
  writeFileSync(githubOutput, '');

  const fullEnv = {
    PATH: `${fakesDir}:${process.env.PATH}`,
    HOME: dir,
    FAKE_LOG: log,
    FAKE_LOG_DIR: logDir,
    GITHUB_OUTPUT: githubOutput,
    AZURE_SUBSCRIPTION_ID: '00000000-0000-0000-0000-000000000000',
    AZURE_RESOURCE_GROUP: 'frejsi',
    APP_VERSION: 'v0.1.0',
    ...env,
  };
  for (const k of omit) delete fullEnv[k];
  const r = spawnSync('bash', [deploySh], { cwd: path.join(dir, 'repo'), env: fullEnv, encoding: 'utf8' });
  const calls = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean);
  return {
    status: r.status,
    stdout: r.stdout,
    stderr: r.stderr,
    output: r.stdout + r.stderr,
    calls,
    logDir,
    githubOutput: readFileSync(githubOutput, 'utf8'),
  };
}

test('fails on the first missing variable before touching Azure', () => {
  const r = runDeploy({ omit: ['APP_VERSION'] });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /APP_VERSION/);
  assert.equal(r.calls.filter((c) => c.startsWith('az ')).length, 0, r.calls.join('\n'));
});

test('a web bundle without a root server.js fails before touching Azure', () => {
  // Static Web Apps would accept the upload and time out warming up ten minutes later (v0.2.1).
  const r = runDeploy({ rootServer: false });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /standalone\/server\.js is missing/);
  assert.equal(r.calls.filter((c) => c.startsWith('az ')).length, 0, r.calls.join('\n'));
});

test('first release: creates the database user and the Web PubSub secret once, migrates, deploys poller and web', () => {
  const r = runDeploy({ env: { FAKE_EXISTING_SECRETS: 'bootstrap-token' } });
  assert.equal(r.status, 0, r.output);
  const calls = r.calls.join('\n');

  // A contained user in the database, created by the deploy principal, password never on a command
  // line. Nothing runs in master: the deploy principal needs db_owner in this one database only.
  const sqlFiles = readFileSync(path.join(r.logDir, 'sqlcmd-1.sql'), 'utf8');
  assert.match(sqlFiles, /CREATE USER \[frejsi_app\] WITH PASSWORD/);
  assert.match(sqlFiles, /ALTER ROLE db_owner ADD MEMBER \[frejsi_app\]/);
  assert.doesNotMatch(sqlFiles, /LOGIN/, 'no server login');
  const sqlcmds = r.calls.filter((c) => c.startsWith('sqlcmd'));
  assert.equal(sqlcmds.length, 1, sqlcmds.join('\n'));
  assert.match(sqlcmds[0], /-d frejsi /);
  assert.doesNotMatch(calls, /sqlcmd .*-d master/);
  const password = sqlFiles.match(/PASSWORD = N?'([^']+)'/)[1];
  assert.ok(password.length >= 32, 'generated password is long');
  assert.match(password, /[A-Z]/);
  assert.match(password, /[a-z]/);
  assert.match(password, /[0-9]/);
  assert.match(calls, /sqlcmd .*--authentication-method ActiveDirectoryDefault/);
  assert.doesNotMatch(calls, new RegExp(password), 'password appears in a command line');
  assert.match(readFileSync(path.join(r.logDir, 'secret-database-url'), 'utf8'), new RegExp(`password=${password};`));
  assert.match(readFileSync(path.join(r.logDir, 'secret-web-pubsub-connection-string'), 'utf8'), /AccessKey=FAKEWPSKEY/);
  assert.ok(!existsSync(path.join(r.logDir, 'secret-bootstrap-token')), 'bootstrap-token is Bicep\'s, never written here');

  // Firewall rule for the runner, opened before the migration and removed after it.
  const open = r.calls.findIndex((c) => /sql server firewall-rule create .*203\.0\.113\.7/.test(c));
  const migrate = r.calls.findIndex((c) => /^pnpm .*prisma migrate deploy/.test(c));
  const close = r.calls.findIndex((c) => /sql server firewall-rule delete/.test(c));
  assert.ok(open >= 0 && migrate > open && close > migrate, calls);
  assert.match(readFileSync(path.join(r.logDir, 'pnpm-database-url'), 'utf8'), new RegExp(`password=${password}`));

  // Poller: settings, then the zip, then WEBSITE_RUN_FROM_PACKAGE verified.
  const settings = r.calls.find((c) => /functionapp config appsettings set/.test(c));
  assert.match(settings, /SCM_DO_BUILD_DURING_DEPLOYMENT=false/);
  assert.match(settings, /APP_VERSION=v0\.1\.0/);
  const zip = r.calls.find((c) => /functionapp deployment source config-zip/.test(c));
  assert.match(zip, /--src \S+poller\S*\.zip/);
  assert.match(calls, /functionapp config appsettings list .*WEBSITE_RUN_FROM_PACKAGE/);

  // SWA app settings from section 7 of the plan, read from Key Vault, PUT as a body file (never argv).
  const swa = JSON.parse(readFileSync(path.join(r.logDir, 'swa-appsettings.json'), 'utf8')).properties;
  assert.match(swa.DATABASE_URL, new RegExp(`^sqlserver://sql-frejsi-abc\\.database\\.windows\\.net:1433;database=frejsi;user=frejsi_app;password=${password};encrypt=true$`));
  assert.equal(swa.BOOTSTRAP_TOKEN, 'FAKEBOOTSTRAPTOKEN');
  assert.match(swa.WEB_PUBSUB_CONNECTION_STRING, /^Endpoint=https:\/\/wps-frejsi-abc\.webpubsub\.azure\.com;AccessKey=FAKEWPSKEY;Version=1\.0;$/);
  assert.equal(swa.WEB_PUBSUB_HUB, 'frejsi');
  assert.equal(swa.SOURCE_CONNECT_URL, 'https://frejsi-poller-abc.azurewebsites.net/api/source-connect');
  assert.equal(swa.SOURCE_CONNECT_KEY, 'FAKEFUNCTIONKEY');
  assert.match(swa.APPLICATIONINSIGHTS_CONNECTION_STRING, /^InstrumentationKey=/);
  assert.equal(swa.APP_ORIGIN, 'https://happy-sea-0abc.1.azurestaticapps.net');
  assert.equal(swa.NEXT_PUBLIC_APP_VERSION, 'v0.1.0');
  const swaPut = r.calls.findIndex((c) => /^az rest --method put .*config\/appsettings/.test(c));
  // Every command line the script runs, docker and curl included: no secret on any of them.
  for (const line of r.calls) {
    for (const marker of [password, ...SECRET_MARKERS]) assert.ok(!line.includes(marker), `${marker} on a command line: ${line}`);
  }
  const upload = r.calls.find((c) => /^docker run/.test(c));
  assert.match(upload, /staticappsclient/);
  assert.match(upload, /--skipAppBuild true/);
  // The deployment token reaches the container through a mode-600 env file, never docker's argv.
  assert.match(upload, /--env-file \S+/);
  assert.match(upload, /--apiToken "\$SWA_TOKEN"/, 'the token is expanded inside the container, not by the host shell');
  assert.equal(readFileSync(path.join(r.logDir, 'docker-env-file-mode'), 'utf8').trim(), '600');
  assert.match(readFileSync(path.join(r.logDir, 'docker-env-file'), 'utf8'), /^SWA_TOKEN=FAKESWATOKEN$/m);
  // The runner-IP lookup is bounded: no external call without a timeout.
  const ip = r.calls.find((c) => /^curl .*api\.ipify\.org/.test(c));
  assert.match(ip, /--max-time \d+/);
  assert.match(ip, /--retry \d+/);
  assert.ok(swaPut >= 0 && swaPut < r.calls.indexOf(upload), 'settings before upload');
  assert.match(r.githubOutput, /^app_origin=https:\/\/happy-sea-0abc\.1\.azurestaticapps\.net$/m);
});

test('an existing SQL server (SQL_SERVER_ID): its own subscription and group for the hostname and the firewall rule', () => {
  const id = '/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/shared-rg/providers/Microsoft.Sql/servers/shared-sql';
  const r = runDeploy({ env: { FAKE_EXISTING_SECRETS: 'bootstrap-token', SQL_SERVER_ID: id } });
  assert.equal(r.status, 0, r.output);
  assert.ok(!r.calls.some((c) => /resource list .*Microsoft\.Sql\/servers/.test(c)), 'looked for a server in the resource group');
  const target = /--subscription 11111111-1111-1111-1111-111111111111 -g shared-rg (-n|--server) shared-sql/;
  assert.match(r.calls.find((c) => /sql server show/.test(c)), target);
  assert.match(r.calls.find((c) => /sql server firewall-rule create/.test(c)), target);
  assert.match(r.calls.find((c) => /sql server firewall-rule delete/.test(c)), target);
  assert.match(r.calls.find((c) => c.startsWith('sqlcmd')), /-S shared-sql\.database\.windows\.net -d frejsi /);
  assert.match(readFileSync(path.join(r.logDir, 'secret-database-url'), 'utf8'), /^sqlserver:\/\/shared-sql\.database\.windows\.net:1433;database=frejsi;user=frejsi_app;/);
});

test('a malformed SQL_SERVER_ID fails before touching Azure', () => {
  const r = runDeploy({ env: { SQL_SERVER_ID: 'shared-sql' } });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /SQL_SERVER_ID/);
  assert.equal(r.calls.filter((c) => c.startsWith('az ')).length, 0, r.calls.join('\n'));
});

test('never echoes a secret', () => {
  const r = runDeploy({ env: { FAKE_EXISTING_SECRETS: 'bootstrap-token' } });
  assert.equal(r.status, 0, r.output);
  const sql = readFileSync(path.join(r.logDir, 'sqlcmd-1.sql'), 'utf8');
  const password = sql.match(/PASSWORD = N?'([^']+)'/)[1];
  for (const marker of [...SECRET_MARKERS, password]) {
    assert.ok(!r.output.includes(marker), `${marker} leaked to the log:\n${r.output}`);
  }
});

test('later releases: existing secrets are reused, no user is created', () => {
  const r = runDeploy({ env: { FAKE_EXISTING_SECRETS: 'database-url web-pubsub-connection-string bootstrap-token' } });
  assert.equal(r.status, 0, r.output);
  assert.equal(r.calls.filter((c) => c.startsWith('sqlcmd')).length, 0);
  assert.equal(r.calls.filter((c) => /keyvault secret set/.test(c)).length, 0);
  assert.match(readFileSync(path.join(r.logDir, 'pnpm-database-url'), 'utf8'), /password=FAKEDBPASSWORD/);
});

test('custom domain wins over the default hostname for APP_ORIGIN', () => {
  const r = runDeploy({ env: { FAKE_EXISTING_SECRETS: 'database-url web-pubsub-connection-string bootstrap-token', CUSTOM_DOMAIN: 'frejsi.jepsen.ninja' } });
  assert.equal(r.status, 0, r.output);
  const swa = JSON.parse(readFileSync(path.join(r.logDir, 'swa-appsettings.json'), 'utf8')).properties;
  assert.equal(swa.APP_ORIGIN, 'https://frejsi.jepsen.ninja');
  assert.match(r.githubOutput, /^app_origin=https:\/\/frejsi\.jepsen\.ninja$/m);
});

test('the firewall rule is removed even when the migration fails', () => {
  const r = runDeploy({ env: { FAKE_EXISTING_SECRETS: 'database-url web-pubsub-connection-string bootstrap-token', FAKE_FAIL_AT: 'migrate' } });
  assert.notEqual(r.status, 0);
  assert.ok(r.calls.some((c) => /sql server firewall-rule delete/.test(c)), r.calls.join('\n'));
  assert.ok(!r.calls.some((c) => /config-zip/.test(c)), 'nothing deployed after a failed migration');
});

test('waits for the source-connect function key to exist', () => {
  const r = runDeploy({ env: { FAKE_EXISTING_SECRETS: 'database-url web-pubsub-connection-string bootstrap-token', FAKE_FUNCTION_KEY_RETRIES: '2', DEPLOY_RETRY_SLEEP: '0' } });
  assert.equal(r.status, 0, r.output);
  assert.equal(r.calls.filter((c) => /functionapp function keys list/.test(c)).length, 3);
});

test('a failed listKeys stops the deploy; no empty Web PubSub secret is written', () => {
  const r = runDeploy({ env: { FAKE_EXISTING_SECRETS: 'database-url bootstrap-token', FAKE_FAIL_AT: 'wps-listkeys' } });
  assert.notEqual(r.status, 0);
  assert.ok(!r.calls.some((c) => /keyvault secret set .*web-pubsub-connection-string/.test(c)), r.calls.join('\n'));
  assert.ok(!existsSync(path.join(r.logDir, 'secret-web-pubsub-connection-string')), 'an empty secret was written');
  assert.ok(!r.calls.some((c) => /firewall-rule create/.test(c)), 'the deploy went on after the failure');
});

test('a failed Key Vault read stops the deploy before the web settings are replaced', () => {
  const r = runDeploy({ env: { FAKE_EXISTING_SECRETS: 'database-url web-pubsub-connection-string bootstrap-token', FAKE_FAIL_AT: 'secret-show:bootstrap-token' } });
  assert.notEqual(r.status, 0);
  assert.match(r.output, /bootstrap-token/);
  assert.ok(!r.calls.some((c) => /^az rest --method put/.test(c)), 'the SWA settings were PUT after a failed read');
  assert.ok(!existsSync(path.join(r.logDir, 'swa-appsettings.json')));
});

test('an empty Key Vault secret is an error, not an empty app setting', () => {
  const r = runDeploy({ env: { FAKE_EXISTING_SECRETS: 'database-url web-pubsub-connection-string bootstrap-token', FAKE_SECRET_READS_EMPTY: 'web-pubsub-connection-string' } });
  assert.notEqual(r.status, 0);
  assert.match(r.output, /web-pubsub-connection-string/);
  assert.ok(!r.calls.some((c) => /^az rest --method put/.test(c)), 'the SWA settings were PUT with an empty value');
});

test('a failed Key Vault listing stops the deploy; it never counts as "secret absent"', () => {
  // Otherwise the SQL branch would generate a new password and ALTER USER the live application user.
  const r = runDeploy({ env: { FAKE_EXISTING_SECRETS: 'database-url web-pubsub-connection-string bootstrap-token', FAKE_FAIL_AT: 'secret-list' } });
  assert.notEqual(r.status, 0);
  assert.equal(r.calls.filter((c) => c.startsWith('sqlcmd')).length, 0, 'a user was created or altered');
  assert.equal(r.calls.filter((c) => /keyvault secret set/.test(c)).length, 0);
  assert.ok(!r.calls.some((c) => /firewall-rule create/.test(c)), 'the deploy went on after the failure');
});

test('registers the connect handler after the web upload, for the connect event only (issue #95)', () => {
  const r = runDeploy({ env: { FAKE_EXISTING_SECRETS: 'database-url web-pubsub-connection-string bootstrap-token' } });
  assert.equal(r.status, 0, r.output);
  const upload = r.calls.findIndex((c) => c.startsWith('docker run'));
  const hub = r.calls.findIndex((c) => /rest --method put .*webPubSub\/wps-frejsi-abc\/hubs\/frejsi\?/.test(c));
  assert.ok(upload >= 0, r.calls.join('\n'));
  assert.ok(hub > upload, 'the handler is set only once the build that answers it is uploaded');
  const body = JSON.parse(readFileSync(path.join(r.logDir, 'wps-hub.json'), 'utf8'));
  assert.deepEqual(body, {
    properties: {
      anonymousConnectPolicy: 'deny',
      eventHandlers: [
        { urlTemplate: 'https://happy-sea-0abc.1.azurestaticapps.net/api/pubsub', systemEvents: ['connect'], auth: { type: 'None' } },
      ],
    },
  });
});

test('retries the connect handler while the new build comes up, and fails the release if it never validates', () => {
  const secrets = 'database-url web-pubsub-connection-string bootstrap-token';
  const late = runDeploy({ env: { FAKE_EXISTING_SECRETS: secrets, FAKE_HUB_VALIDATION_FAILURES: '2', DEPLOY_RETRY_SLEEP: '0' } });
  assert.equal(late.status, 0, late.output);
  assert.ok(existsSync(path.join(late.logDir, 'wps-hub.json')));
  const never = runDeploy({ env: { FAKE_EXISTING_SECRETS: secrets, FAKE_HUB_VALIDATION_FAILURES: '99', DEPLOY_RETRY_SLEEP: '0' } });
  assert.notEqual(never.status, 0);
  assert.match(never.stderr, /connect handler .* never validated/);
});

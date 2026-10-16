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

const SECRET_MARKERS = ['FICTIONAL_OFF_PASSWORD', 'FICTIONAL_OFF_USER', 'FAKEDBPASSWORD', 'FAKEWPSKEY', 'FAKEBOOTSTRAPTOKEN', 'FAKEFUNCTIONKEY', 'FAKESWATOKEN', 'FAKESAS'];

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
    ALERT_EMAIL: 'alerts@example.invalid',
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

/** Every sqlcmd run, in order: the SQL it was given, the file mode it saw and whether the file is gone now. */
function sqlRuns(r) {
  const out = [];
  for (let n = 1; existsSync(path.join(r.logDir, `sqlcmd-${n}.sql`)); n++) {
    const file = readFileSync(path.join(r.logDir, `sqlcmd-${n}.path`), 'utf8').trim();
    out.push({
      n,
      sql: readFileSync(path.join(r.logDir, `sqlcmd-${n}.sql`), 'utf8'),
      mode: readFileSync(path.join(r.logDir, `sqlcmd-${n}.mode`), 'utf8').trim(),
      file,
      removed: !existsSync(file),
    });
  }
  return out;
}
const identitySql = (r) => sqlRuns(r).find((q) => /TYPE = E/.test(q.sql));
const existingSecrets = 'database-url web-pubsub-connection-string bootstrap-token vapid-private-key vapid-public-key';

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
  // Reads, writes and DDL for the migrations; never db_owner (plan v0.5.0 section 7).
  for (const role of ['db_datareader', 'db_datawriter', 'db_ddladmin']) {
    assert.match(sqlFiles, new RegExp(`ALTER ROLE ${role} ADD MEMBER \\[frejsi_app\\]`));
  }
  assert.doesNotMatch(sqlFiles, /db_owner/);
  assert.doesNotMatch(sqlFiles, /LOGIN/, 'no server login');
  const sqlcmds = r.calls.filter((c) => c.startsWith('sqlcmd'));
  assert.equal(sqlcmds.length, 3, sqlcmds.join('\n'));
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
  for (const c of r.calls.filter((x) => x.startsWith('sqlcmd'))) assert.match(c, /-S shared-sql\.database\.windows\.net -d frejsi /);
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
  const r = runDeploy({ env: { FAKE_EXISTING_SECRETS: 'database-url web-pubsub-connection-string bootstrap-token vapid-private-key vapid-public-key' } });
  assert.equal(r.status, 0, r.output);
  // The identity's contained user and the compatibility level: no application user is created.
  assert.equal(r.calls.filter((c) => c.startsWith('sqlcmd')).length, 2);
  assert.ok(sqlRuns(r).every((q) => !/frejsi_app|PASSWORD/.test(q.sql)), 'the application user was touched');
  assert.equal(r.calls.filter((c) => /keyvault secret set/.test(c)).length, 0);
  assert.match(readFileSync(path.join(r.logDir, 'pnpm-database-url'), 'utf8'), /password=FAKEDBPASSWORD/);
});

test('custom domain wins over the default hostname for APP_ORIGIN', () => {
  const r = runDeploy({ env: { FAKE_EXISTING_SECRETS: 'database-url web-pubsub-connection-string bootstrap-token vapid-private-key vapid-public-key', CUSTOM_DOMAIN: 'frejsi.jepsen.ninja' } });
  assert.equal(r.status, 0, r.output);
  const swa = JSON.parse(readFileSync(path.join(r.logDir, 'swa-appsettings.json'), 'utf8')).properties;
  assert.equal(swa.APP_ORIGIN, 'https://frejsi.jepsen.ninja');
  assert.match(r.githubOutput, /^app_origin=https:\/\/frejsi\.jepsen\.ninja$/m);
});

test('the firewall rule is removed even when the migration fails', () => {
  const r = runDeploy({ env: { FAKE_EXISTING_SECRETS: 'database-url web-pubsub-connection-string bootstrap-token vapid-private-key vapid-public-key', FAKE_FAIL_AT: 'migrate' } });
  assert.notEqual(r.status, 0);
  assert.ok(r.calls.some((c) => /sql server firewall-rule delete/.test(c)), r.calls.join('\n'));
  assert.ok(!r.calls.some((c) => /config-zip/.test(c)), 'nothing deployed after a failed migration');
});

test('waits for the source-connect function key to exist', () => {
  const r = runDeploy({ env: { FAKE_EXISTING_SECRETS: 'database-url web-pubsub-connection-string bootstrap-token vapid-private-key vapid-public-key', FAKE_FUNCTION_KEY_RETRIES: '2', DEPLOY_RETRY_SLEEP: '0' } });
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
  const r = runDeploy({ env: { FAKE_EXISTING_SECRETS: 'database-url web-pubsub-connection-string bootstrap-token vapid-private-key vapid-public-key', FAKE_FAIL_AT: 'secret-show:bootstrap-token' } });
  assert.notEqual(r.status, 0);
  assert.match(r.output, /bootstrap-token/);
  assert.ok(!r.calls.some((c) => /^az rest --method put/.test(c)), 'the SWA settings were PUT after a failed read');
  assert.ok(!existsSync(path.join(r.logDir, 'swa-appsettings.json')));
});

test('an empty Key Vault secret is an error, not an empty app setting', () => {
  const r = runDeploy({ env: { FAKE_EXISTING_SECRETS: 'database-url web-pubsub-connection-string bootstrap-token vapid-private-key vapid-public-key', FAKE_SECRET_READS_EMPTY: 'web-pubsub-connection-string' } });
  assert.notEqual(r.status, 0);
  assert.match(r.output, /web-pubsub-connection-string/);
  assert.ok(!r.calls.some((c) => /^az rest --method put/.test(c)), 'the SWA settings were PUT with an empty value');
});

test('a failed Key Vault listing stops the deploy; it never counts as "secret absent"', () => {
  // Otherwise the SQL branch would generate a new password and ALTER USER the live application user.
  const r = runDeploy({ env: { FAKE_EXISTING_SECRETS: 'database-url web-pubsub-connection-string bootstrap-token vapid-private-key vapid-public-key', FAKE_FAIL_AT: 'secret-list' } });
  assert.notEqual(r.status, 0);
  assert.equal(r.calls.filter((c) => c.startsWith('sqlcmd')).length, 0, 'a user was created or altered');
  assert.equal(r.calls.filter((c) => /keyvault secret set/.test(c)).length, 0);
  assert.ok(!r.calls.some((c) => /firewall-rule create/.test(c)), 'the deploy went on after the failure');
});

test('registers the connect handler after the web upload, for the connect event only (issue #95)', () => {
  const r = runDeploy({ env: { FAKE_EXISTING_SECRETS: 'database-url web-pubsub-connection-string bootstrap-token vapid-private-key vapid-public-key' } });
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

const aiNames = ['ANTHROPIC_API_KEY', 'VOYAGE_API_KEY', 'AZURE_OPENAI_ENDPOINT', 'AZURE_OPENAI_API_KEY',
  'AZURE_OPENAI_DEPLOYMENT_SMALL', 'AZURE_OPENAI_DEPLOYMENT_EVERYDAY', 'AZURE_OPENAI_DEPLOYMENT_INSIGHT',
  'AZURE_OPENAI_DEPLOYMENT_EMBED', 'OLLAMA_URL', 'OLLAMA_MODEL_SMALL', 'OLLAMA_MODEL_EVERYDAY',
  'OLLAMA_MODEL_INSIGHT', 'OLLAMA_MODEL_EMBED', 'AI_CACHE_EMBED_PROVIDER'];
const baseSecrets = 'database-url web-pubsub-connection-string bootstrap-token';
test('optional AI settings: absent secrets are skipped, present values and references stay off argv and stdout', () => {
  const absent = runDeploy({ env: { FAKE_EXISTING_SECRETS: baseSecrets } });
  assert.equal(absent.status, 0, absent.output);
  const swaAbsent = JSON.parse(readFileSync(path.join(absent.logDir, 'swa-appsettings.json'), 'utf8')).properties;
  for (const name of aiNames) {
    assert.ok(!Object.hasOwn(swaAbsent, name));
    assert.match(absent.output, new RegExp(`Skipping optional AI setting ${name}:`));
  }
  const secrets = aiNames.map((name) => name.toLowerCase().replaceAll('_', '-'));
  const present = runDeploy({ env: { FAKE_EXISTING_SECRETS: `${baseSecrets} ${secrets.join(' ')}` } });
  assert.equal(present.status, 0, present.output);
  const swa = JSON.parse(readFileSync(path.join(present.logDir, 'swa-appsettings.json'), 'utf8')).properties;
  const func = JSON.parse(readFileSync(path.join(present.logDir, 'function-ai-settings.json'), 'utf8'));
  for (const [index, name] of aiNames.entries()) {
    assert.equal(swa[name], `FICTIONAL_AI_${secrets[index]}`);
    assert.equal(func[name], `@Microsoft.KeyVault(SecretUri=https://kv-frejsi-abc.vault.azure.net/secrets/${secrets[index]}/)`);
    assert.ok(!present.output.includes(swa[name]), `${name} in output`);
    assert.ok(!present.calls.join('\n').includes(swa[name]), `${name} in argv`);
  }
  assert.equal(readFileSync(path.join(present.logDir, 'function-ai-settings-mode'), 'utf8').trim(), '600');
});
test('an unreadable or empty optional AI secret stops the deploy before replacing web settings', () => {
  for (const failure of [{ FAKE_FAIL_AT: 'secret-show:anthropic-api-key' }, { FAKE_SECRET_READS_EMPTY: 'anthropic-api-key' }]) {
    const r = runDeploy({ env: { FAKE_EXISTING_SECRETS: `${baseSecrets} anthropic-api-key`, ...failure } });
    assert.notEqual(r.status, 0);
    assert.match(r.output, /anthropic-api-key/);
    assert.ok(!existsSync(path.join(r.logDir, 'swa-appsettings.json')));
  }
});
test('raises SQL compatibility to 170 only when lower, after migration and before firewall closure', () => {
  const r = runDeploy({ env: { FAKE_EXISTING_SECRETS: baseSecrets } });
  assert.equal(r.status, 0, r.output);
  const sql = sqlRuns(r).find((q) => /compatibility_level/.test(q.sql)).sql;
  assert.match(sql, /compatibility_level.*< 170/s);
  assert.match(sql, /COMPATIBILITY_LEVEL = 170/);
  assert.match(sql, /QUOTENAME\(DB_NAME\(\)\)/);
  const migrate = r.calls.findIndex((c) => /^pnpm .*migrate deploy/.test(c));
  const compatibility = r.calls.findLastIndex((c) => /^sqlcmd /.test(c));
  const close = r.calls.findIndex((c) => /firewall-rule delete/.test(c));
  assert.ok(migrate < compatibility && compatibility < close);
  assert.match(r.calls[compatibility], /-b/);
});
test('removing optional AI secrets also removes only their stale Function App settings', () => {
  for (const remaining of ['', 'anthropic-api-key']) {
    const r = runDeploy({ env: { FAKE_EXISTING_SECRETS: `${baseSecrets} ${remaining}`, FAKE_FUNCTION_SETTING_NAMES: 'APP_VERSION ANTHROPIC_API_KEY OLLAMA_MODEL_SMALL' } });
    assert.equal(r.status, 0, r.output);
    const deleted = r.calls.find((c) => /functionapp config appsettings delete/.test(c));
    assert.ok(deleted, r.calls.join('\n'));
    assert.match(deleted, /OLLAMA_MODEL_SMALL/);
    assert.equal(deleted.includes('ANTHROPIC_API_KEY'), !remaining);
    assert.ok(!deleted.includes('APP_VERSION'), 'removed unrelated settings');
    assert.equal(existsSync(path.join(r.logDir, 'function-ai-settings.json')), Boolean(remaining));
  }
});

test('VAPID: generates a pair once, recovers a partial write, reuses existing keys and never prints values', () => {
  const first = runDeploy();
  assert.equal(first.status, 0, first.output);
  const settings = JSON.parse(readFileSync(path.join(first.logDir, 'swa-appsettings.json'), 'utf8')).properties;
  assert.equal(settings.VAPID_SUBJECT, 'mailto:alerts@example.invalid');
  assert.match(settings.VAPID_PRIVATE_KEY, /^[A-Za-z0-9_-]{43}$/);
  assert.match(settings.VAPID_PUBLIC_KEY, /^[A-Za-z0-9_-]{87}$/);
  assert.doesNotMatch(first.output + first.calls.join('\n'), new RegExp(settings.VAPID_PRIVATE_KEY));
  assert.equal(first.calls.filter((c) => /keyvault secret set .* -n vapid-/.test(c)).length, 2);
  const recovered = runDeploy({env: {FAKE_EXISTING_SECRETS: 'vapid-private-key', FAKE_VAPID_PRIVATE: settings.VAPID_PRIVATE_KEY}});
  assert.equal(recovered.status, 0, recovered.output);
  const repaired = JSON.parse(readFileSync(path.join(recovered.logDir, 'swa-appsettings.json'), 'utf8')).properties;
  assert.equal(repaired.VAPID_PRIVATE_KEY, settings.VAPID_PRIVATE_KEY);
  assert.equal(repaired.VAPID_PUBLIC_KEY, settings.VAPID_PUBLIC_KEY);
  assert.equal(recovered.calls.filter((c) => /keyvault secret set .* -n vapid-private-key/.test(c)).length, 0);
  assert.equal(recovered.calls.filter((c) => /keyvault secret set .* -n vapid-public-key/.test(c)).length, 1);
  const existing = runDeploy({env: {FAKE_EXISTING_SECRETS: 'vapid-private-key vapid-public-key'}});
  assert.equal(existing.status, 0, existing.output);
  assert.equal(existing.calls.filter((c) => /keyvault secret set .* -n vapid-/.test(c)).length, 0);
  const next = JSON.parse(readFileSync(path.join(existing.logDir, 'swa-appsettings.json'), 'utf8')).properties;
  assert.equal(next.VAPID_PRIVATE_KEY, 'FICTIONAL_VAPID_PRIVATE');
  assert.equal(next.VAPID_PUBLIC_KEY, 'FICTIONAL_VAPID_PUBLIC');
  assert.doesNotMatch(existing.output + existing.calls.join('\n'), /FICTIONAL_VAPID/);
});
test('VAPID: a missing private half or unreadable key fails before replacing app settings', () => {
  for (const env of [
    {FAKE_EXISTING_SECRETS: 'vapid-public-key'},
    {FAKE_EXISTING_SECRETS: 'vapid-private-key vapid-public-key', FAKE_FAIL_AT: 'secret-show:vapid-private-key'},
  ]) {
    const r = runDeploy({env});
    assert.notEqual(r.status, 0);
    assert.equal(existsSync(path.join(r.logDir, 'swa-appsettings.json')), false);
  }
});

const clientId = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

test('creates the identity\'s contained user by SID as the Entra admin, between the migration and the firewall closure', () => {
  const r = runDeploy({ env: { FAKE_EXISTING_SECRETS: existingSecrets } });
  assert.equal(r.status, 0, r.output);
  const q = identitySql(r);
  assert.ok(q, 'no SQL creating a TYPE = E user');
  // Idempotent, named after the identity, SID from its client id (no Microsoft Graph lookup).
  assert.match(q.sql, /IF NOT EXISTS \(SELECT 1 FROM sys\.database_principals WHERE name = N'id-frejsi-abc'/);
  // SQL Server takes a binary literal after SID =, so the statement is dynamic SQL over the SID
  // computed from the client id as varbinary(16).
  assert.match(q.sql, new RegExp(`@sid varbinary\\(16\\) = CONVERT\\(varbinary\\(16\\), CAST\\('${clientId}' AS uniqueidentifier\\)\\)`));
  assert.match(q.sql, /N'CREATE USER \[id-frejsi-abc\] WITH SID = ' \+ CONVERT\(nvarchar\(max\), @sid, 1\) \+ N', TYPE = E;'/);
  assert.match(q.sql, /EXEC \(@create\)/);
  assert.doesNotMatch(q.sql, /WITH SID = CONVERT/, 'an expression after SID = does not parse');
  assert.doesNotMatch(q.sql, /FROM EXTERNAL PROVIDER/);
  // Read and write rows only: the poller never runs DDL.
  assert.match(q.sql, /ALTER ROLE db_datareader ADD MEMBER \[id-frejsi-abc\]/);
  assert.match(q.sql, /ALTER ROLE db_datawriter ADD MEMBER \[id-frejsi-abc\]/);
  assert.doesNotMatch(q.sql, /db_owner|db_ddladmin|db_datareader.*DROP/s);
  // Order: client id read, firewall open, migration, user, firewall closed.
  const idx = (re) => r.calls.findIndex((c) => re.test(c));
  const show = idx(/^az identity show .*-n id-frejsi-abc .*clientId/);
  const open = idx(/firewall-rule create/);
  const migrate = idx(/^pnpm .*migrate deploy/);
  const user = r.calls.findIndex((c, i) => /^sqlcmd /.test(c) && i > migrate);
  const close = idx(/firewall-rule delete/);
  assert.ok(show >= 0 && open >= 0 && migrate > open && user > migrate && close > user, r.calls.join('\n'));
  assert.match(r.calls[user], /--authentication-method ActiveDirectoryDefault/);
  assert.match(r.calls[user], /-b/);
});

test('the identity\'s SQL travels in a mode-600 file that is gone afterwards', () => {
  const r = runDeploy({ env: { FAKE_EXISTING_SECRETS: existingSecrets } });
  assert.equal(r.status, 0, r.output);
  const runs = sqlRuns(r);
  assert.ok(runs.length >= 2);
  for (const q of runs) {
    assert.equal(q.mode, '600', q.file);
    assert.ok(q.removed, `${q.file} was left behind`);
  }
});

test('a missing or malformed client id stops the deploy before any SQL is run for the identity', () => {
  for (const bad of ['', 'not-a-guid', "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'; DROP USER x; --"]) {
    const r = runDeploy({ env: { FAKE_EXISTING_SECRETS: existingSecrets, FAKE_IDENTITY_CLIENT_ID: bad } });
    assert.notEqual(r.status, 0, `accepted ${JSON.stringify(bad)}`);
    assert.match(r.stderr, /client id/i);
    assert.equal(identitySql(r), undefined);
    assert.ok(r.calls.some((c) => /firewall-rule delete/.test(c)), 'the firewall rule must still be closed');
    assert.ok(!r.calls.some((c) => /config-zip/.test(c)), 'nothing deployed');
  }
});

test('exactly one user-assigned identity is expected in the group', () => {
  const r = runDeploy({ env: { FAKE_EXISTING_SECRETS: existingSecrets, FAKE_IDENTITY_NAME: '' } });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Microsoft\.ManagedIdentity\/userAssignedIdentities/);
});

test('DATABASE_URL leaves the Function App only after WEBSITE_RUN_FROM_PACKAGE is verified', () => {
  const r = runDeploy({ env: { FAKE_EXISTING_SECRETS: existingSecrets, FAKE_FUNCTION_SETTING_NAMES: 'APP_VERSION DATABASE_URL WEBSITE_RUN_FROM_PACKAGE' } });
  assert.equal(r.status, 0, r.output);
  const deletes = r.calls.filter((c) => /functionapp config appsettings delete .*DATABASE_URL/.test(c));
  assert.equal(deletes.length, 1, r.calls.join('\n'));
  assert.match(deletes[0], /--setting-names DATABASE_URL/);
  assert.ok(!/(APP_VERSION|WEBSITE_RUN_FROM_PACKAGE)/.test(deletes[0]), 'only DATABASE_URL');
  const zip = r.calls.findIndex((c) => /config-zip/.test(c));
  const verified = r.calls.findIndex((c, i) => i > zip && /appsettings list .*WEBSITE_RUN_FROM_PACKAGE/.test(c));
  const del = r.calls.indexOf(deletes[0]);
  const user = r.calls.findIndex((c) => /^sqlcmd .*/.test(c) && r.calls.indexOf(c) > r.calls.findIndex((x) => /migrate deploy/.test(x)));
  assert.ok(zip >= 0 && verified > zip && del > verified && del > user, r.calls.join('\n'));
});

test('a fresh fork has no DATABASE_URL setting to delete; that is a no-op, not an error', () => {
  const r = runDeploy({ env: { FAKE_EXISTING_SECRETS: existingSecrets, FAKE_FUNCTION_SETTING_NAMES: 'APP_VERSION' } });
  assert.equal(r.status, 0, r.output);
  assert.ok(!r.calls.some((c) => /appsettings delete .*DATABASE_URL/.test(c)));
});

test('DATABASE_URL is kept when the package is not running', () => {
  // No WEBSITE_RUN_FROM_PACKAGE after the zip deploy fails the release before the old setting goes.
  const r = runDeploy({ env: { FAKE_EXISTING_SECRETS: existingSecrets, FAKE_FUNCTION_SETTING_NAMES: 'DATABASE_URL', FAKE_NO_RUN_FROM_PACKAGE: '1' } });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /WEBSITE_RUN_FROM_PACKAGE/);
  assert.ok(!r.calls.some((c) => /appsettings delete/.test(c)));
});

test('each OFF secret reaches the web settings only when it exists; otherwise a one-line notice', () => {
  const absent = runDeploy({ env: { FAKE_EXISTING_SECRETS: existingSecrets } });
  assert.equal(absent.status, 0, absent.output);
  const swaAbsent = JSON.parse(readFileSync(path.join(absent.logDir, 'swa-appsettings.json'), 'utf8')).properties;
  for (const name of ['OFF_CONTRIBUTE_USER', 'OFF_CONTRIBUTE_PASSWORD']) {
    assert.ok(!Object.hasOwn(swaAbsent, name));
    assert.match(absent.output, new RegExp(`Skipping optional OFF setting ${name}: Key Vault secret off-contribute-(user|password) is absent`));
  }
  const present = runDeploy({ env: { FAKE_EXISTING_SECRETS: `${existingSecrets} off-contribute-user off-contribute-password` } });
  assert.equal(present.status, 0, present.output);
  const swa = JSON.parse(readFileSync(path.join(present.logDir, 'swa-appsettings.json'), 'utf8')).properties;
  assert.equal(swa.OFF_CONTRIBUTE_USER, 'FICTIONAL_OFF_USER');
  assert.equal(swa.OFF_CONTRIBUTE_PASSWORD, 'FICTIONAL_OFF_PASSWORD');
  assert.doesNotMatch(present.output, /Skipping optional OFF/);
  // Neither value on any command line or in the log.
  for (const marker of ['FICTIONAL_OFF_USER', 'FICTIONAL_OFF_PASSWORD']) {
    assert.ok(!present.output.includes(marker), `${marker} in output`);
    assert.ok(!present.calls.join('\n').includes(marker), `${marker} in argv`);
  }
  // Only one of the two: that one is written, the other skipped.
  const half = runDeploy({ env: { FAKE_EXISTING_SECRETS: `${existingSecrets} off-contribute-user` } });
  const swaHalf = JSON.parse(readFileSync(path.join(half.logDir, 'swa-appsettings.json'), 'utf8')).properties;
  assert.equal(swaHalf.OFF_CONTRIBUTE_USER, 'FICTIONAL_OFF_USER');
  assert.ok(!Object.hasOwn(swaHalf, 'OFF_CONTRIBUTE_PASSWORD'));
});

test('DEFAULT_LOCALE, FOOD_SOURCES and OFF_COUNTRY reach the web settings only when set', () => {
  const unset = runDeploy({ env: { FAKE_EXISTING_SECRETS: existingSecrets, DEFAULT_LOCALE: '', FOOD_SOURCES: '' } });
  assert.equal(unset.status, 0, unset.output);
  const swaUnset = JSON.parse(readFileSync(path.join(unset.logDir, 'swa-appsettings.json'), 'utf8')).properties;
  for (const name of ['DEFAULT_LOCALE', 'FOOD_SOURCES', 'OFF_COUNTRY']) assert.ok(!Object.hasOwn(swaUnset, name), name);
  const set = runDeploy({ env: { FAKE_EXISTING_SECRETS: existingSecrets, DEFAULT_LOCALE: 'en', FOOD_SOURCES: 'off,frida', OFF_COUNTRY: 'gb' } });
  assert.equal(set.status, 0, set.output);
  const swa = JSON.parse(readFileSync(path.join(set.logDir, 'swa-appsettings.json'), 'utf8')).properties;
  assert.equal(swa.DEFAULT_LOCALE, 'en');
  assert.equal(swa.FOOD_SOURCES, 'off,frida');
  assert.equal(swa.OFF_COUNTRY, 'gb');
  // Only the one that is set.
  const one = runDeploy({ env: { FAKE_EXISTING_SECRETS: existingSecrets, DEFAULT_LOCALE: 'en' } });
  const swaOne = JSON.parse(readFileSync(path.join(one.logDir, 'swa-appsettings.json'), 'utf8')).properties;
  assert.equal(swaOne.DEFAULT_LOCALE, 'en');
  assert.ok(!Object.hasOwn(swaOne, 'FOOD_SOURCES') && !Object.hasOwn(swaOne, 'OFF_COUNTRY'));
});

test('prints nothing secret across the whole run, identity included', () => {
  const r = runDeploy({ env: { FAKE_EXISTING_SECRETS: `${existingSecrets} off-contribute-user off-contribute-password`, FAKE_FUNCTION_SETTING_NAMES: 'DATABASE_URL' } });
  assert.equal(r.status, 0, r.output);
  for (const marker of SECRET_MARKERS) {
    assert.ok(!r.output.includes(marker), `${marker} leaked`);
    assert.ok(!r.calls.join('\n').includes(marker), `${marker} on a command line`);
  }
});

import { appendFileSync, existsSync, readFileSync } from "node:fs";

import {
  createSecretsFromEnv,
  log,
  NightscoutSource,
  parseNightscoutCredential,
  type Secrets,
} from "@naensom/shared";

import {
  APNS_KEY_ID,
  APNS_KEY_SECRET,
  APNS_TEAM_ID,
  ApnsSender,
  LIVE_ACTIVITY_TOPIC,
} from "./live/apns";
import { DEFAULT_ATTRIBUTES } from "./live/payloads";
import { parsePushTestArgs, USAGE } from "./live/push-test-args";
import { CSV_HEADER, initialState, pushTestTick } from "./live/push-test-run";

/**
 * `pnpm --filter ./poller push-test`: the iPhone app's stage-2 push test (ios/README.md). Runs on an
 * operator's machine, not in the Function App. The Nightscout address and token come from the
 * environment (`NS_URL`, `NS_TOKEN`), or from a Key Vault secret holding a stored Nightscout
 * credential (`NS_CREDENTIAL_SECRET`, e.g. a space's `pump-<spaceId>`), read here so no person or
 * shell ever sees it. Neither is ever logged; the log carries outcome codes, the CSV (a local file the
 * operator asked for) carries times and values.
 */
async function main(): Promise<void> {
  if (process.argv.includes("--help")) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  const args = parsePushTestArgs(process.argv.slice(2), process.env, new Date());
  let secrets: Secrets | undefined;
  const vault = (): Secrets => (secrets ??= createSecretsFromEnv());
  const site = await nightscoutCredential(vault);
  if (args.activityToken === undefined && args.activityTokenFile === undefined) {
    throw new Error("give --activity-token, LIVE_ACTIVITY_TOKEN or --activity-token-file");
  }

  const keyFile = process.env.APNS_KEY_FILE;
  const keyP8 = keyFile ? readFileSync(keyFile, "utf8") : await vault().get(APNS_KEY_SECRET);
  if (!keyP8)
    throw new Error(`no APNs key: set APNS_KEY_FILE or put ${APNS_KEY_SECRET} in Key Vault`);

  const nightscout = new NightscoutSource({ ...site, log });
  const apns = new ApnsSender({
    keyP8,
    keyId: APNS_KEY_ID,
    teamId: APNS_TEAM_ID,
    topic: LIVE_ACTIVITY_TOPIC,
    environment: args.environment,
  });

  if (!existsSync(args.csvPath)) appendFileSync(args.csvPath, `${CSV_HEADER}\n`);
  const tokenFile = args.activityTokenFile;
  const deps = {
    readLatest: () => nightscout.latestEntries(3),
    send: (request: Parameters<ApnsSender["send"]>[0]) => apns.send(request),
    activityToken: () => {
      if (tokenFile === undefined) return Promise.resolve(args.activityToken);
      if (!existsSync(tokenFile)) return Promise.resolve(undefined);
      const value = readFileSync(tokenFile, "utf8").trim().toLowerCase();
      return Promise.resolve(/^[0-9a-f]{32,400}$/.test(value) ? value : undefined);
    },
    writeCsv: (line: string) => {
      appendFileSync(args.csvPath, `${line}\n`);
    },
    now: () => Date.now(),
    log,
  };
  const options = {
    pushToStartToken: args.pushToStartToken,
    attributes: DEFAULT_ATTRIBUTES,
    restartAfterMs: args.restartAfterMs,
    priority: args.priority,
  };
  const state = initialState(args.activityStartedAt ?? Date.now());

  log.info("push-test.started", {
    code: `${args.environment}:${args.pushToStartToken ? "restart-on" : "restart-off"}`,
  });
  const control = { stopping: false };
  process.on("SIGINT", () => {
    control.stopping = true;
  });
  process.on("SIGTERM", () => {
    control.stopping = true;
  });
  do {
    await pushTestTick(deps, options, state);
    if (args.once) break;
    await new Promise((resolve) => setTimeout(resolve, args.intervalMs));
  } while (!control.stopping);
  apns.close();
  log.info("push-test.stopped", { count: state.restarts });
}

/** The site and its credential: `NS_URL` + `NS_TOKEN`, or the stored credential `NS_CREDENTIAL_SECRET` names. */
async function nightscoutCredential(
  vault: () => Secrets,
): Promise<{ url: string; token?: string; apiSecret?: string }> {
  const secretName = process.env.NS_CREDENTIAL_SECRET;
  if (secretName) {
    const stored = await vault().get(secretName);
    if (!stored) throw new Error("the NS_CREDENTIAL_SECRET secret was not found");
    let credential;
    try {
      credential = parseNightscoutCredential(stored);
    } catch {
      // The parse error could quote the value; say only that it is not a credential.
      throw new Error("the NS_CREDENTIAL_SECRET secret is not a Nightscout credential");
    }
    log.info("push-test.credential", { code: credential.token ? "token" : "secret" });
    return credential.token
      ? { url: credential.url, token: credential.token }
      : { url: credential.url, apiSecret: credential.apiSecret ?? "" };
  }
  const url = process.env.NS_URL;
  const token = process.env.NS_TOKEN;
  if (!url || !token) {
    throw new Error("set NS_URL and NS_TOKEN (a read-only token), or NS_CREDENTIAL_SECRET");
  }
  if (!url.startsWith("https://")) throw new Error("NS_URL must start with https://");
  return { url, token };
}

main().catch((error: unknown) => {
  // The message is ours (argument or setup errors) and never holds a token or the address.
  process.stderr.write(`${error instanceof Error ? error.message : "push-test failed"}\n`);
  process.exitCode = 1;
});

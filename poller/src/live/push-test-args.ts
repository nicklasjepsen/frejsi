import type { ApnsEnvironment } from "./apns";
import { DEFAULT_RESTART_AFTER_MS } from "./push-test-run";

export interface PushTestArgs {
  /** A fixed activity token, or undefined when `activityTokenFile` names where to read it. */
  activityToken?: string;
  activityTokenFile?: string;
  pushToStartToken?: string;
  environment: ApnsEnvironment;
  csvPath: string;
  restartAfterMs: number;
  intervalMs: number;
  /** Unix milliseconds the running activity started; defaults to now. */
  activityStartedAt?: number;
  priority: 5 | 10;
  once: boolean;
}

export const USAGE = `pnpm --filter ./poller push-test [options]

  --activity-token <hex>        the Live Activity's push token (or LIVE_ACTIVITY_TOKEN)
  --activity-token-file <path>  re-read every tick; write the new token here after a restart
  --push-to-start-token <hex>   for the restart at 7 h 45 min (or PUSH_TO_START_TOKEN)
  --env sandbox|production      APNs host (default sandbox: Simulator and Xcode builds)
  --csv <path>                  where the push log goes (default push-test-<time>.csv)
  --restart-after <minutes>     default 465 (7 h 45 min)
  --activity-started-at <iso>   when the running activity started (default now)
  --interval <seconds>          how often Nightscout is read (default 30)
  --priority 5|10               default 10
  --once                        one pass, then exit

Environment: NS_URL and NS_TOKEN (the Nightscout site and a read-only token), or
NS_CREDENTIAL_SECRET (a Key Vault secret with a stored Nightscout credential), and APNS_KEY_FILE
(the .p8 file) or KEY_VAULT_URL (secret apns-key-p8).`;

type Env = Record<string, string | undefined>;

const HEX = /^[0-9a-f]{32,400}$/;

function hexToken(value: string, flag: string): string {
  const token = value.trim().toLowerCase();
  if (!HEX.test(token)) throw new Error(`${flag} must be a hex push token`);
  return token;
}

function positive(value: string, flag: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${flag} must be a positive number`);
  return n;
}

/** Anything unknown or malformed is an error, never a guess. Error messages never echo a token. */
export function parsePushTestArgs(argv: string[], env: Env, now: Date): PushTestArgs {
  const values = new Map<string, string>();
  let once = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (arg === "--once") {
      once = true;
      continue;
    }
    if (!arg.startsWith("--")) throw new Error(`unexpected argument ${arg}`);
    const eq = arg.indexOf("=");
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    let value = eq === -1 ? argv[i + 1] : arg.slice(eq + 1);
    if (eq === -1) i += 1;
    if (value === undefined || value === "" || value.startsWith("--")) {
      throw new Error(`${flag} needs a value`);
    }
    value = value.trim();
    if (
      ![
        "--activity-token",
        "--activity-token-file",
        "--push-to-start-token",
        "--env",
        "--csv",
        "--restart-after",
        "--activity-started-at",
        "--interval",
        "--priority",
      ].includes(flag)
    ) {
      throw new Error(`unknown option ${flag}`);
    }
    values.set(flag, value);
  }

  const activityValue = values.get("--activity-token") ?? env.LIVE_ACTIVITY_TOKEN;
  const activityTokenFile = values.get("--activity-token-file");
  if (activityValue !== undefined && activityTokenFile !== undefined) {
    throw new Error("give --activity-token or --activity-token-file, not both");
  }
  const pushToStartValue = values.get("--push-to-start-token") ?? env.PUSH_TO_START_TOKEN;

  const environment = values.get("--env") ?? "sandbox";
  if (environment !== "sandbox" && environment !== "production") {
    throw new Error("--env must be sandbox or production");
  }
  const priority = values.get("--priority") ?? "10";
  if (priority !== "5" && priority !== "10") throw new Error("--priority must be 5 or 10");

  const startedText = values.get("--activity-started-at");
  const activityStartedAt = startedText === undefined ? undefined : Date.parse(startedText);
  if (activityStartedAt !== undefined && Number.isNaN(activityStartedAt)) {
    throw new Error("--activity-started-at must be an ISO time");
  }

  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const args: PushTestArgs = {
    environment,
    csvPath: values.get("--csv") ?? `push-test-${stamp}.csv`,
    restartAfterMs: values.has("--restart-after")
      ? positive(values.get("--restart-after") ?? "", "--restart-after") * 60_000
      : DEFAULT_RESTART_AFTER_MS,
    intervalMs: positive(values.get("--interval") ?? "30", "--interval") * 1000,
    priority: priority === "5" ? 5 : 10,
    once,
  };
  if (activityValue !== undefined) args.activityToken = hexToken(activityValue, "--activity-token");
  if (activityTokenFile !== undefined) args.activityTokenFile = activityTokenFile;
  if (pushToStartValue !== undefined) {
    args.pushToStartToken = hexToken(pushToStartValue, "--push-to-start-token");
  }
  if (activityStartedAt !== undefined) args.activityStartedAt = activityStartedAt;
  return args;
}

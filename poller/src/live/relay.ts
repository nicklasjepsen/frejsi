import {
  liveAlertText,
  liveRestartText,
  liveSecretName,
  NightscoutError,
  NightscoutSource,
  parseNightscoutCredential,
  type FetchLike,
  type LiveAlertKind,
  type LiveLanguage,
  type LiveUnit,
  type Logger,
  type NightscoutEntry,
  type Secrets,
} from "@naensom/shared";

import {
  APNS_KEY_ID,
  APNS_KEY_SECRET,
  APNS_TEAM_ID,
  ApnsSender,
  LIVE_ACTIVITY_TOPIC,
  type ApnsEnvironment,
  type ApnsRequest,
  type ApnsResult,
} from "./apns";
import { decideAlert } from "./alerts";
import { demoEntries } from "./demo";
import {
  alertPayload,
  contentState,
  endPayload,
  STALE_AFTER_SECONDS,
  startPayload,
  updatePayload,
  type ContentState,
} from "./payloads";
import { DUE_SLACK_MS, nextCheckAt, restartIsDue, RETRY_EVERY_MS } from "./schedule";
import type { LivePatch, LiveRow, LiveStore } from "./store";

/**
 * The `live-poll` pass (plan 2026-11-08-ios-follower-app §4): for each subscription that is due,
 * read the newest three entries (or the demo curve), send one Live Activity `update` when the
 * newest reading is new, restart the activity by push-to-start at 7 h 45 min, send the low/high
 * reminder by the §1 rules, and clean up what Apple or time says is gone. Log lines carry the
 * subscription id and outcome codes only: never an address, a token or a value.
 */

/** Subscriptions are deleted when nothing reached them and the app has not registered for this long. */
export const IDLE_AFTER_MS = 30 * 24 * 60 * 60_000;
/** At most this many sites are read at once. */
export const CHECK_CONCURRENCY = 16;
/** At most this many subscriptions per run; the rest are still due on the next. */
export const MAX_CHECKS_PER_RUN = 1_000;
export const MAX_CLEANUPS_PER_RUN = 100;
/** Per Nightscout read; well under the timer's minute. */
export const RELAY_READ_TIMEOUT_MS = 15_000;
/** The relay reads three entries: a duplicate still leaves one for the change. */
export const ENTRIES_PER_READ = 3;
/** A reading dated further ahead than this is a clock error and is ignored. */
export const FUTURE_TOLERANCE_MS = 2 * 60_000;
/** A subscription with no push token at all is not polled; it goes after a day without one. */
export const TOKENLESS_GRACE_MS = 24 * 60 * 60_000;
export const TOKENLESS_RECHECK_MS = 60 * 60_000;
/** The orphan sweep runs in the run that starts in this minute of each hour (the timer is a singleton). */
export const SWEEP_MINUTE = 0;
/**
 * A `live-<id>` secret younger than this is kept even without a row: registration writes the
 * secret first and the row right after.
 */
export const ORPHAN_GRACE_MS = 60 * 60_000;
/** `live-`, the prefix every subscription's secret name starts with. */
const LIVE_SECRET_PREFIX = liveSecretName("");

export type ReadEntries = (row: LiveRow, now: number) => Promise<NightscoutEntry[]>;
export type SendPush = (environment: ApnsEnvironment, request: ApnsRequest) => Promise<ApnsResult>;

export interface RelayDeps {
  store: LiveStore;
  secrets: Pick<Secrets, "delete" | "list">;
  readEntries: ReadEntries;
  send: SendPush;
  /** Unix milliseconds. */
  now: () => number;
  log: Logger;
}

/** Apple's verdict on one push, as the relay acts on it. */
export type PushVerdict = "accepted" | "invalid-token" | "retry" | "refused";

/** 410, `BadDeviceToken` and `Unregistered` mean the token is gone for good. */
export function verdictOf(result: ApnsResult | undefined): PushVerdict {
  if (result === undefined) return "retry";
  if (result.status === 200) return "accepted";
  if (
    result.status === 410 ||
    result.reason === "BadDeviceToken" ||
    result.reason === "Unregistered"
  ) {
    return "invalid-token";
  }
  if (result.status >= 500 || result.status === 429) return "retry";
  return "refused";
}

/** Reads the subscription's site with its stored credential, or the demo curve. */
export function createEntryReader(options: {
  secrets: Pick<Secrets, "get">;
  fetch?: FetchLike;
  timeoutMs?: number;
}): ReadEntries {
  // By versioned reference: a version never changes, so a cached one is never out of date.
  // The relay stores a token, never an API secret (live-register takes a `readable` token only).
  const credentials = new Map<string, { url: string; token: string }>();
  return async (row, now) => {
    if (row.isDemo) return demoEntries(now, ENTRIES_PER_READ);
    const ref = row.tokenSecretRef;
    if (ref === null) throw new NightscoutError("NoCredential", 0);
    let credential = credentials.get(ref);
    if (credential === undefined) {
      const value = await options.secrets.get(ref);
      if (value === undefined) throw new NightscoutError("NoCredential", 0);
      const parsed = parseNightscoutCredential(value);
      if (parsed.token === undefined) throw new NightscoutError("NoCredential", 0);
      credential = { url: parsed.url, token: parsed.token };
      credentials.set(ref, credential);
    }
    const source = new NightscoutSource({
      url: credential.url,
      token: credential.token,
      timeoutMs: options.timeoutMs ?? RELAY_READ_TIMEOUT_MS,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });
    return source.latestEntries(ENTRIES_PER_READ);
  };
}

/**
 * One `ApnsSender` per environment, made on first use and kept for the process: the key is read
 * from Key Vault (`apns-key-p8`) once, and a failed read is tried again on the next send.
 */
export function createApnsSenders(secrets: Pick<Secrets, "get">): SendPush {
  let key: Promise<string> | undefined;
  const senders = new Map<ApnsEnvironment, ApnsSender>();
  const loadKey = () => {
    key ??= secrets.get(APNS_KEY_SECRET).then((value) => {
      if (value === undefined) throw new Error("apns-key-missing");
      return value;
    });
    key.catch(() => {
      key = undefined;
    });
    return key;
  };
  return async (environment, request) => {
    let sender = senders.get(environment);
    if (sender === undefined) {
      sender = new ApnsSender({
        keyP8: await loadKey(),
        keyId: APNS_KEY_ID,
        teamId: APNS_TEAM_ID,
        topic: LIVE_ACTIVITY_TOPIC,
        environment,
      });
      senders.set(environment, sender);
    }
    return sender.send(request);
  };
}

/** Deletes the row and its Key Vault secret: the secret first, so a failure leaves the row to retry. */
export async function removeSubscription(
  deps: { store: LiveStore; secrets: Pick<Secrets, "delete"> },
  row: Pick<LiveRow, "id" | "tokenSecretRef">,
): Promise<void> {
  if (row.tokenSecretRef !== null) await deps.secrets.delete(liveSecretName(row.id));
  await deps.store.delete(row.id);
}

/**
 * Deletes `live-<id>` after its row is already gone, trying once more on a failure. A secret that
 * still will not go is logged and left to the hourly orphan sweep; it never fails the caller.
 */
async function deleteLiveSecret(deps: RelayDeps, id: string): Promise<void> {
  const name = liveSecretName(id);
  try {
    await deps.secrets.delete(name);
  } catch {
    try {
      await deps.secrets.delete(name);
    } catch (error) {
      deps.log.error(
        "live.secret-delete-failed",
        { subscriptionId: id, code: "left-to-sweep" },
        error,
      );
    }
  }
}

/**
 * Deletes every `live-<id>` secret whose row is gone and which is older than the grace period:
 * what a cleanup's failed secret delete, or a registration whose row write failed, left behind.
 * Rows are deleted before their secret (a re-registration must win the race), so without this a
 * failed delete would keep an address and a token in Key Vault for good. Answers the count.
 */
export async function sweepOrphanSecrets(deps: RelayDeps): Promise<number> {
  let listed;
  try {
    listed = await deps.secrets.list(LIVE_SECRET_PREFIX);
  } catch (error) {
    deps.log.error("live.secret-sweep-failed", { code: "list" }, error);
    return 0;
  }
  const cutoff = deps.now() - ORPHAN_GRACE_MS;
  const old = listed.filter((secret) => secret.updatedOn.getTime() <= cutoff);
  let removed = 0;
  await mapLimit(old, CHECK_CONCURRENCY, async (secret) => {
    const id = secret.name.slice(LIVE_SECRET_PREFIX.length);
    try {
      if ((await deps.store.get(id)) !== null) return;
      // The rest go on the next hour's sweep.
      if (removed >= MAX_CLEANUPS_PER_RUN) return;
      removed += 1;
      await deps.secrets.delete(secret.name);
      deps.log.info("live.secret-orphan-removed", { subscriptionId: id, code: "no-row" });
    } catch (error) {
      deps.log.error("live.secret-sweep-failed", { subscriptionId: id, code: "delete" }, error);
    }
  });
  return removed;
}

function environmentOf(row: LiveRow): ApnsEnvironment {
  return row.apnsEnvironment === "production" ? "production" : "sandbox";
}

function languageOf(row: LiveRow): LiveLanguage {
  return row.language === "da" ? "da" : "en";
}

function unitOf(row: LiveRow): LiveUnit {
  return row.unit === "mgdL" ? "mgdL" : "mmolL";
}

type TokenField = "pushToStartToken" | "activityPushToken" | "deviceToken";

/** What one check did, for the run's summary line. */
export type CheckOutcome =
  "pushed" | "unchanged" | "restarted" | "read-failed" | "push-retry" | "removed" | "error";

interface Pass {
  row: LiveRow;
  now: number;
  patch: LivePatch;
  /** Tokens Apple called invalid; cleared only if the row still holds them. */
  invalid: Set<TokenField>;
  codes: string[];
}

async function push(
  deps: RelayDeps,
  pass: Pass,
  event: string,
  field: TokenField,
  request: Omit<ApnsRequest, "deviceToken">,
): Promise<PushVerdict> {
  const token = pass.row[field];
  if (token === null) return "refused";
  let result: ApnsResult | undefined;
  try {
    result = await deps.send(environmentOf(pass.row), { ...request, deviceToken: token });
  } catch {
    result = undefined;
  }
  const verdict = verdictOf(result);
  pass.codes.push(
    `${event}:${result === undefined ? "send-failed" : String(result.status)}${result?.reason ? `:${result.reason}` : ""}`,
  );
  if (verdict === "accepted") {
    pass.patch.lastSeenAt = new Date(pass.now);
    pass.patch.lastPushAt = new Date(pass.now);
  } else if (verdict === "invalid-token") {
    pass.invalid.add(field);
  }
  return verdict;
}

/** End the old activity and start a new one by push-to-start; true when Apple took the start. */
async function restart(deps: RelayDeps, pass: Pass, content: ContentState): Promise<PushVerdict> {
  const nowS = Math.floor(pass.now / 1000);
  if (pass.row.activityPushToken !== null) {
    await push(deps, pass, "end", "activityPushToken", {
      pushType: "liveactivity",
      priority: 10,
      payload: endPayload(content, nowS),
    });
    // Ended either way: no more updates go to it, and a retried start does not end it again.
    pass.invalid.add("activityPushToken");
  }
  const verdict = await push(deps, pass, "start", "pushToStartToken", {
    pushType: "liveactivity",
    priority: 10,
    payload: startPayload(
      content,
      { unit: unitOf(pass.row) },
      nowS,
      liveRestartText(languageOf(pass.row)),
    ),
  });
  if (verdict === "accepted") {
    // The new activity's token arrives when the app next registers.
    pass.patch.activityStartedAt = new Date(pass.now);
  } else if (verdict !== "retry") {
    // Refused or the token is gone: stop trying; the app offers "tap to restart".
    pass.patch.activityStartedAt = null;
  }
  return verdict;
}

async function alert(
  deps: RelayDeps,
  pass: Pass,
  newest: NightscoutEntry | undefined,
  newestReadingAt: number | null,
): Promise<void> {
  const { row, now } = pass;
  const decision = decideAlert(row, newest, newestReadingAt, now);
  if (decision === null) return;
  if ("reset" in decision) {
    pass.patch.lastAlertKind = null;
    pass.patch.lastAlertAt = null;
    return;
  }
  const kind: LiveAlertKind = decision.send;
  const language = languageOf(row);
  const ageMs =
    now - (kind === "stale" || newest === undefined ? (newestReadingAt ?? now) : newest.date);
  const text =
    kind === "stale" || newest === undefined
      ? liveAlertText(language, { kind: "stale", ageMs })
      : liveAlertText(language, { kind, mgdl: newest.mgdl, unit: unitOf(row), ageMs });
  const expiresAt =
    kind === "stale" || newest === undefined
      ? Math.floor(now / 1000) + STALE_AFTER_SECONDS
      : Math.floor(newest.date / 1000) + STALE_AFTER_SECONDS;
  const verdict = await push(deps, pass, `alert-${kind}`, "deviceToken", {
    pushType: "alert",
    priority: 10,
    payload: alertPayload(text),
    expiration: Math.max(expiresAt, Math.floor(now / 1000) + 60),
  });
  // A retry is tried again on the next pass; anything else counts as sent, so a refusal is not
  // repeated every minute.
  if (verdict !== "retry") {
    pass.patch.lastAlertKind = kind;
    pass.patch.lastAlertAt = new Date(now);
  }
}

/**
 * Clears the tokens Apple called invalid, and removes the subscription when it can no longer
 * reach the phone: when no token is left, or when Apple rejected the push-to-start token and no
 * activity token is left either. A rejected push-to-start token means the app is gone from the
 * phone (deleted, or its tokens reset); a device token left beside it would otherwise keep the
 * row, and the reminders going, for as long as Apple accepted them. An activity token the app
 * registered meanwhile keeps the subscription until that activity ends. Answers why it removed
 * the row, or null.
 */
async function settleTokens(
  deps: RelayDeps,
  pass: Pass,
): Promise<"tokens-invalid" | "push-to-start-invalid" | null> {
  if (pass.invalid.size === 0) return null;
  const { row } = pass;
  for (const field of pass.invalid) {
    const token = row[field];
    if (token === null) continue;
    await deps.store.update(row.id, { [field]: null }, { [field]: token });
  }
  const current = await deps.store.get(row.id);
  // Gone already, or a push token is left that can still reach the phone.
  if (current?.pushToStartToken !== null || current.activityPushToken !== null) return null;
  let reason: "tokens-invalid" | "push-to-start-invalid";
  if (current.deviceToken === null) reason = "tokens-invalid";
  else if (pass.invalid.has("pushToStartToken")) reason = "push-to-start-invalid";
  else return null;
  // Like the idle cleanup: the row first, and only if the app has not registered since this pass
  // read it (a registration may have changed what the tokens mean, say Live Activity turned
  // off); then its secret, tried twice, and swept within the hour when both tries failed.
  if (!(await deps.store.deleteIfUnseen(row.id, row.lastSeenAt))) return null;
  if (row.tokenSecretRef !== null) await deleteLiveSecret(deps, row.id);
  return reason;
}

/**
 * Writes the pass's state, unless the app registered meanwhile (a new activity, site or demo
 * switch): then the reading, schedule and activity fields are left as the registration set them,
 * so a new activity still gets the newest reading on the next run, and only the rest is written.
 */
async function savePass(deps: RelayDeps, pass: Pass): Promise<void> {
  const { row, patch } = pass;
  const guard: LivePatch = {
    activityPushToken: pass.invalid.has("activityPushToken") ? null : row.activityPushToken,
    tokenSecretRef: row.tokenSecretRef,
    isDemo: row.isDemo,
  };
  if (await deps.store.update(row.id, patch, guard)) return;
  const {
    lastReadingAt: _reading,
    nextCheckAt: _next,
    activityStartedAt: _started,
    activityPushToken: _token,
    ...rest
  } = patch;
  await deps.store.update(row.id, rest);
}

/** One subscription's pass. Never throws for Nightscout or Apple; a database failure does. */
export async function checkSubscription(deps: RelayDeps, row: LiveRow): Promise<CheckOutcome> {
  const now = deps.now();
  const pass: Pass = { row, now, patch: {}, invalid: new Set(), codes: [] };
  const known = row.lastReadingAt?.getTime() ?? null;

  // Nothing can reach a phone without a token: no site is read, and after a day without one the
  // subscription goes (an app registers its tokens within seconds of starting).
  if (row.pushToStartToken === null && row.activityPushToken === null && row.deviceToken === null) {
    if (now - row.lastSeenAt.getTime() >= TOKENLESS_GRACE_MS) {
      if (await deps.store.deleteIfUnseen(row.id, row.lastSeenAt)) {
        if (row.tokenSecretRef !== null) await deleteLiveSecret(deps, row.id);
        deps.log.info("live.removed", { subscriptionId: row.id, code: "no-tokens" });
        return "removed";
      }
      return "unchanged";
    }
    pass.patch.nextCheckAt = new Date(now + TOKENLESS_RECHECK_MS);
    await savePass(deps, pass);
    return "unchanged";
  }

  let entries: NightscoutEntry[];
  try {
    entries = (await deps.readEntries(row, now)).filter(
      (entry) => entry.date <= now + FUTURE_TOLERANCE_MS,
    );
  } catch (error) {
    const code = error instanceof NightscoutError ? error.code : "unknown";
    deps.log.warn("live.read-failed", { subscriptionId: row.id, code });
    await alert(deps, pass, undefined, known);
    const removed = await settleTokens(deps, pass);
    if (removed !== null) {
      deps.log.info("live.removed", { subscriptionId: row.id, code: removed });
      return "removed";
    }
    pass.patch.failures = row.failures + 1;
    pass.patch.nextCheckAt = new Date(
      nextCheckAt(now, { newestReadingAt: known, restartFrom: restartFromOf(row) }),
    );
    await savePass(deps, pass);
    return "read-failed";
  }

  const [newest, previous] = entries;
  let outcome: CheckOutcome = "unchanged";
  let newestReadingAt = known;
  pass.patch.failures = 0;

  if (newest !== undefined) {
    const isNew = known === null || newest.date > known;
    const content = contentState(newest, previous);
    let delivered = true;
    if (
      row.activityStartedAt !== null &&
      row.pushToStartToken !== null &&
      restartIsDue(now, row.activityStartedAt.getTime())
    ) {
      const verdict = await restart(deps, pass, content);
      if (verdict === "accepted") outcome = "restarted";
      else if (verdict === "retry") {
        outcome = "push-retry";
        delivered = !isNew;
      }
    } else if (isNew && row.activityPushToken !== null) {
      const verdict = await push(deps, pass, "update", "activityPushToken", {
        pushType: "liveactivity",
        priority: 10,
        payload: updatePayload(content, Math.floor(now / 1000)),
        expiration: content.readingAt + STALE_AFTER_SECONDS,
      });
      if (verdict === "retry") {
        outcome = "push-retry";
        delivered = false;
      } else if (verdict === "accepted") {
        outcome = "pushed";
      }
    }
    if (isNew && delivered) pass.patch.lastReadingAt = new Date(newest.date);
    newestReadingAt = Math.max(known ?? newest.date, newest.date);
    await alert(deps, pass, newest, newestReadingAt);
    pass.patch.nextCheckAt = new Date(
      delivered
        ? nextCheckAt(now, {
            newestReadingAt,
            restartFrom: restartFromOf({ ...row, ...pass.patch }),
          })
        : // A push to retry: the next run, a minute away, sends it again.
          now + RETRY_EVERY_MS,
    );
  } else {
    await alert(deps, pass, undefined, known);
    pass.patch.nextCheckAt = new Date(
      nextCheckAt(now, { newestReadingAt: known, restartFrom: restartFromOf(row) }),
    );
  }

  const removed = await settleTokens(deps, pass);
  if (removed !== null) {
    deps.log.info("live.removed", { subscriptionId: row.id, code: removed });
    return "removed";
  }
  await savePass(deps, pass);
  const fields = {
    subscriptionId: row.id,
    code: pass.codes.length === 0 ? outcome : pass.codes.join(","),
  };
  if (outcome === "push-retry") deps.log.warn("live.check", fields);
  else deps.log.info("live.check", fields);
  return outcome;
}

function restartFromOf(
  row: Pick<LiveRow, "activityStartedAt" | "pushToStartToken">,
): number | null {
  if (row.activityStartedAt === null || row.pushToStartToken === null) return null;
  return row.activityStartedAt.getTime();
}

/** Runs `task` over `items`, at most `limit` at once. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await task(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * One `live-poll` run: idle cleanup, once an hour the orphan-secret sweep, then every due
 * subscription, a summary line at the end.
 */
export async function runLivePoll(deps: RelayDeps): Promise<Record<CheckOutcome, number>> {
  const started = deps.now();
  const idle = await deps.store.idle(new Date(started - IDLE_AFTER_MS), MAX_CLEANUPS_PER_RUN);
  for (const row of idle) {
    try {
      // The row first, and only if the app has not registered since it was selected; then its
      // secret, tried twice, and swept within the hour when both tries failed.
      if (!(await deps.store.deleteIfUnseen(row.id, row.lastSeenAt))) continue;
      if (row.tokenSecretRef !== null) await deleteLiveSecret(deps, row.id);
      deps.log.info("live.removed", { subscriptionId: row.id, code: "idle-30-days" });
    } catch (error) {
      deps.log.error("live.remove-failed", { subscriptionId: row.id, code: "idle" }, error);
    }
  }
  if (new Date(started).getUTCMinutes() === SWEEP_MINUTE) await sweepOrphanSecrets(deps);

  const due = await deps.store.due(new Date(started + DUE_SLACK_MS), MAX_CHECKS_PER_RUN);
  const outcomes = await mapLimit(due, CHECK_CONCURRENCY, async (row) => {
    try {
      return await checkSubscription(deps, row);
    } catch (error) {
      deps.log.error("live.check-failed", { subscriptionId: row.id, code: "error" }, error);
      return "error" as const;
    }
  });
  const summary: Record<CheckOutcome, number> = {
    pushed: 0,
    unchanged: 0,
    restarted: 0,
    "read-failed": 0,
    "push-retry": 0,
    removed: 0,
    error: 0,
  };
  for (const outcome of outcomes) summary[outcome] += 1;
  deps.log.info("live.poll", {
    count: due.length,
    code:
      Object.entries(summary)
        .filter(([, n]) => n > 0)
        .map(([name, n]) => `${name}:${String(n)}`)
        .join(",") || "idle",
    ms: deps.now() - started,
  });
  return summary;
}

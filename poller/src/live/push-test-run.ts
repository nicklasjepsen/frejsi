import type { Logger } from "@naensom/shared";

import type { ApnsRequest, ApnsResult } from "./apns";
import {
  contentState,
  endPayload,
  startPayload,
  updatePayload,
  type ActivityAttributes,
  type ContentState,
  type Entry,
} from "./payloads";

/**
 * The stage-2 push test (plan 2026-11-08-ios-follower-app §7): poll a Nightscout site, send one
 * `update` push per new reading to a Live Activity, and at 7 h 45 min end it and start a new one by
 * push-to-start, with the app never opened. Every push is one CSV row the operator compares with
 * lock-screen screenshots. The log lines carry outcome codes only; the CSV, written locally on the
 * operator's request, is the one place values appear.
 */

/** Apple ends an activity at 8 hours; restart a quarter of an hour before. */
export const DEFAULT_RESTART_AFTER_MS = (7 * 60 + 45) * 60_000;

export const CSV_HEADER =
  "sent_at,event,reading_at,reading_age_s,mgdl,direction,delta,apns_status,apns_reason,apns_id";

export interface PushTestOptions {
  pushToStartToken: string | undefined;
  attributes: ActivityAttributes;
  restartAfterMs: number;
  priority: 5 | 10;
}

export interface PushTestDeps {
  /** The newest entries, newest first (three: a duplicate still leaves one for the change). */
  readLatest(): Promise<Entry[]>;
  send(request: ApnsRequest): Promise<ApnsResult>;
  /** The current activity token: fixed, or re-read from a file each tick. */
  activityToken(): Promise<string | undefined>;
  writeCsv(line: string): void;
  /** Unix milliseconds. */
  now(): number;
  log: Logger;
}

export interface PushTestState {
  activityToken: string | undefined;
  /** Unix milliseconds the current activity started (or the test began). */
  activityStartedAt: number;
  /** The newest reading already pushed, Unix milliseconds. */
  lastSentReadingAt: number | undefined;
  /** Tokens of activities this test ended; a token file still naming one is ignored. */
  retiredTokens: Set<string>;
  restarts: number;
  warnedNoPushToStart: boolean;
}

export function initialState(activityStartedAt: number): PushTestState {
  return {
    activityToken: undefined,
    activityStartedAt,
    lastSentReadingAt: undefined,
    retiredTokens: new Set(),
    restarts: 0,
    warnedNoPushToStart: false,
  };
}

type Event = "update" | "end" | "start" | "update-skipped";

function csvRow(
  sentAtMs: number,
  event: Event,
  state: ContentState,
  result: ApnsResult | undefined,
): string {
  const readingAgeS = Math.round(sentAtMs / 1000 - state.readingAt);
  return [
    new Date(sentAtMs).toISOString(),
    event,
    new Date(state.readingAt * 1000).toISOString(),
    readingAgeS,
    state.mgdl,
    state.direction,
    state.delta ?? "",
    result?.status ?? "",
    result?.reason ?? "",
    result?.apnsId ?? "",
  ].join(",");
}

/** One pass: pick up a new activity token, read Nightscout, push what is new, restart when due. */
export async function pushTestTick(
  deps: PushTestDeps,
  options: PushTestOptions,
  state: PushTestState,
): Promise<void> {
  const token = await deps.activityToken();
  if (token !== undefined && token !== state.activityToken && !state.retiredTokens.has(token)) {
    state.activityToken = token;
    // A new activity gets the newest reading at once, even one an earlier pass could not send.
    state.lastSentReadingAt = undefined;
    deps.log.info("push-test.activity-token", { code: "new" });
  }

  let entries: Entry[];
  try {
    entries = await deps.readLatest();
  } catch (error) {
    deps.log.warn("push-test.read-failed", {
      code: error instanceof Error && "code" in error ? String(error.code) : "unknown",
    });
    return;
  }
  const [newest, previous] = entries;
  if (newest === undefined) {
    deps.log.warn("push-test.no-readings");
    return;
  }
  const content = contentState(newest, previous);

  if (deps.now() - state.activityStartedAt >= options.restartAfterMs) {
    if (options.pushToStartToken === undefined) {
      if (!state.warnedNoPushToStart)
        deps.log.warn("push-test.restart-skipped", { code: "no-push-to-start-token" });
      state.warnedNoPushToStart = true;
    } else {
      await restart(deps, options, state, content, options.pushToStartToken);
      state.lastSentReadingAt = newest.date;
      return;
    }
  }

  if (state.lastSentReadingAt !== undefined && newest.date <= state.lastSentReadingAt) return;

  if (state.activityToken === undefined) {
    deps.writeCsv(csvRow(deps.now(), "update-skipped", content, undefined));
    deps.log.warn("push-test.update-skipped", { code: "no-activity-token" });
    state.lastSentReadingAt = newest.date;
    return;
  }

  const result = await sendLogged(deps, "update", content, {
    deviceToken: state.activityToken,
    pushType: "liveactivity",
    priority: options.priority,
    payload: updatePayload(content, Math.floor(deps.now() / 1000)),
  });
  // A failed connection throws and leaves lastSentReadingAt, so the next tick tries again.
  if (result !== undefined) state.lastSentReadingAt = newest.date;
}

async function restart(
  deps: PushTestDeps,
  options: PushTestOptions,
  state: PushTestState,
  content: ContentState,
  pushToStartToken: string,
): Promise<void> {
  const nowS = Math.floor(deps.now() / 1000);
  if (state.activityToken !== undefined) {
    await sendLogged(deps, "end", content, {
      deviceToken: state.activityToken,
      pushType: "liveactivity",
      priority: 10,
      payload: endPayload(content, nowS),
    });
    state.retiredTokens.add(state.activityToken);
  }
  state.activityToken = undefined;
  const started = await sendLogged(deps, "start", content, {
    deviceToken: pushToStartToken,
    pushType: "liveactivity",
    priority: 10,
    payload: startPayload(content, options.attributes, nowS),
  });
  // A send that threw (no connection) is tried again next tick; Apple's refusal is recorded and the
  // test goes on, so a refused token does not mean a push every 30 seconds.
  if (started === undefined) return;
  state.activityStartedAt = deps.now();
  state.restarts += 1;
  deps.log.info("push-test.restarted", { count: state.restarts });
}

/** Sends, writes the CSV row and one log line with the status; undefined when the send threw. */
async function sendLogged(
  deps: PushTestDeps,
  event: Event,
  content: ContentState,
  request: ApnsRequest,
): Promise<ApnsResult | undefined> {
  let result: ApnsResult;
  try {
    result = await deps.send(request);
  } catch (error) {
    deps.log.warn("push-test.send-failed", {
      code: `${event}:${error instanceof Error ? error.message : "unknown"}`,
    });
    return undefined;
  }
  deps.writeCsv(csvRow(deps.now(), event, content, result));
  const fields = { code: `${event}:${result.status}${result.reason ? `:${result.reason}` : ""}` };
  if (result.status === 200) deps.log.info("push-test.sent", fields);
  else deps.log.warn("push-test.refused", fields);
  return result;
}

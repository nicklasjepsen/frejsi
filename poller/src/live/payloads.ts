/**
 * The Live Activity push payloads (plan 2026-11-08-ios-follower-app §4). The content state is the
 * contract with the app's `LiveGlucoseState` (ios/Packages/FollowCore), pinned by the fixture both
 * sides test against: `{ mgdl, direction, delta, readingAt }`, `readingAt` in Unix seconds.
 */

/** The `ActivityAttributes` type the app declares; a push-to-start names it. */
export const ACTIVITY_ATTRIBUTES_TYPE = "GlucoseActivityAttributes";

/** A reading turns stale 15 minutes after it was taken, on the phone and in the payload. */
export const STALE_AFTER_SECONDS = 15 * 60;

/** Two readings further apart than this have no meaningful change between them. */
export const MAX_DELTA_GAP_MS = 12 * 60_000;

export interface Entry {
  /** Unix milliseconds. */
  date: number;
  mgdl: number;
  direction: string;
}

export interface ContentState {
  mgdl: number;
  direction: string;
  /** mg/dL since the previous reading, null without one in the last 12 minutes. */
  delta: number | null;
  /** Unix seconds. */
  readingAt: number;
}

/**
 * The activity's fixed attributes, as the app's `GlucoseActivityAttributes` encodes them: the unit
 * only. The colour thresholds live in the app's settings, which the Live Activity reads itself.
 */
export interface ActivityAttributes {
  unit: "mmolL" | "mgdL";
}

export const DEFAULT_ATTRIBUTES: ActivityAttributes = { unit: "mmolL" };

export function contentState(current: Entry, previous: Entry | undefined): ContentState {
  const gap = previous === undefined ? -1 : current.date - previous.date;
  const delta =
    previous !== undefined && gap >= 0 && gap <= MAX_DELTA_GAP_MS
      ? current.mgdl - previous.mgdl
      : null;
  return {
    mgdl: current.mgdl,
    direction: current.direction,
    delta,
    readingAt: Math.floor(current.date / 1000),
  };
}

/** A new reading for a running activity. */
export function updatePayload(state: ContentState, now: number): object {
  return {
    aps: {
      timestamp: now,
      event: "update",
      "content-state": state,
      "stale-date": state.readingAt + STALE_AFTER_SECONDS,
    },
  };
}

/** Ends an activity and removes it from the lock screen at once (the 8-hour restart). */
export function endPayload(state: ContentState, now: number): object {
  return {
    aps: {
      timestamp: now,
      event: "end",
      "content-state": state,
      "dismissal-date": now,
    },
  };
}

/**
 * Starts a new activity on a phone whose app is closed (iOS 17.2 push-to-start). iOS requires an
 * alert with it; the alert carries no value, because a value is never shown without its age.
 */
export function startPayload(
  state: ContentState,
  attributes: ActivityAttributes,
  now: number,
): object {
  return {
    aps: {
      timestamp: now,
      event: "start",
      "content-state": state,
      "stale-date": state.readingAt + STALE_AFTER_SECONDS,
      "attributes-type": ACTIVITY_ATTRIBUTES_TYPE,
      attributes,
      alert: { title: "Live Activity", body: "Restarted" },
    },
  };
}

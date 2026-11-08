/**
 * When the relay next reads a subscription's site (plan 2026-11-08-ios-follower-app §4): the
 * newest reading + 5 min 15 s, then every minute until a new reading arrives, backing off to every
 * five minutes once the newest reading is 20 minutes old. The `live-poll` timer runs every minute
 * and checks every subscription whose time has come.
 */

/** A CGM uploads every five minutes; 15 s more gives the uploader time to reach Nightscout. */
export const FIRST_CHECK_AFTER_MS = 5 * 60_000 + 15_000;
export const RETRY_EVERY_MS = 60_000;
export const BACKOFF_AFTER_MS = 20 * 60_000;
export const BACKOFF_EVERY_MS = 5 * 60_000;
/** Apple ends a Live Activity at 8 hours; the relay restarts it a quarter of an hour before. */
export const RESTART_AFTER_MS = (7 * 60 + 45) * 60_000;
/**
 * The timer fires at second 0 of each minute; a check whose time is within this much of the run
 * is taken now, so "every minute" never slips to every two.
 */
export const DUE_SLACK_MS = 20_000;

export interface ScheduleInput {
  /** Unix milliseconds of the newest reading the relay knows, or null before the first. */
  newestReadingAt: number | null;
  /** When the current activity started, when a push-to-start can restart it. */
  restartFrom: number | null;
}

export function nextCheckAt(now: number, input: ScheduleInput): number {
  let next: number;
  const newest = input.newestReadingAt;
  if (newest === null) {
    next = now + BACKOFF_EVERY_MS;
  } else if (now < newest + FIRST_CHECK_AFTER_MS) {
    next = newest + FIRST_CHECK_AFTER_MS;
  } else if (now - newest < BACKOFF_AFTER_MS) {
    next = now + RETRY_EVERY_MS;
  } else {
    next = now + BACKOFF_EVERY_MS;
  }
  if (input.restartFrom !== null) {
    next = Math.min(next, Math.max(now + RETRY_EVERY_MS, input.restartFrom + RESTART_AFTER_MS));
  }
  return next;
}

/** True when the activity is old enough to be restarted by push-to-start. */
export function restartIsDue(now: number, activityStartedAt: number): boolean {
  return now - activityStartedAt >= RESTART_AFTER_MS;
}

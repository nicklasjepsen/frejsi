import type { LiveAlertKind } from "@naensom/shared";

/**
 * The low/high reminder's repeat rules (plan 2026-11-08-ios-follower-app §1): one alert when a
 * reading crosses below the low or above the high threshold, again after 30 minutes if it is still
 * out of range, and one alert when the newest reading is 20 minutes old. A reading back in range
 * resets it, so the next crossing alerts again.
 */
export const ALERT_REPEAT_MS = 30 * 60_000;
export const STALE_ALERT_AFTER_MS = 20 * 60_000;

export interface AlertState {
  alertsOn: boolean;
  deviceToken: string | null;
  lowMgdl: number;
  highMgdl: number;
  lastAlertKind: string | null;
  lastAlertAt: Date | null;
}

export type AlertDecision = { send: LiveAlertKind } | { reset: true } | null;

/**
 * What to do on this pass. `newest` is the newest reading just read (undefined when the read
 * failed); `newestReadingAt` the newest the relay knows, for the no-new-readings alert.
 */
export function decideAlert(
  state: AlertState,
  newest: { date: number; mgdl: number } | undefined,
  newestReadingAt: number | null,
  now: number,
): AlertDecision {
  if (!state.alertsOn || state.deviceToken === null || newestReadingAt === null) return null;
  if (now - newestReadingAt >= STALE_ALERT_AFTER_MS) {
    return state.lastAlertKind === "stale" ? null : { send: "stale" };
  }
  if (newest === undefined) return null;
  const kind: LiveAlertKind | null =
    newest.mgdl < state.lowMgdl ? "low" : newest.mgdl > state.highMgdl ? "high" : null;
  if (kind === null) return state.lastAlertKind === null ? null : { reset: true };
  if (state.lastAlertKind !== kind) return { send: kind };
  const last = state.lastAlertAt?.getTime();
  if (last === undefined || now - last >= ALERT_REPEAT_MS) return { send: kind };
  return null;
}

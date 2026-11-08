import type { NightscoutEntry } from "@naensom/shared";

/**
 * The demo source (plan 2026-11-08-ios-follower-app §4): a subscription whose address is `demo`
 * follows a made-up curve the relay computes itself, a pure function of the time. No real person's
 * data, no Nightscout call. App Review and the Simulator use it.
 */

/** A CGM reading every five minutes. */
export const DEMO_INTERVAL_MS = 5 * 60_000;
/** The newest demo reading is a minute or more old, as a real uploader's is. */
export const DEMO_LAG_MS = 60_000;

const TWO_PI = 2 * Math.PI;

/**
 * The same curve as the app's `DemoCurve` (ios/Packages/FollowCore), so the app, its own Live
 * Activity updates and the relay's pushes show the same value at the same moment:
 *
 *     mgdl(t) = round(140 + 55 sin(2 pi t / 10800) + 18 sin(2 pi t / 2700 + 1)),  t in Unix seconds
 *
 * a three-hour wave between about 67 and 213 mg/dL with a 45-minute ripple, so it passes through
 * low, in range and high with the default thresholds.
 */
export function demoMgdl(at: number): number {
  const t = at / 1000;
  return Math.round(
    140 + 55 * Math.sin((TWO_PI * t) / 10_800) + 18 * Math.sin((TWO_PI * t) / 2_700 + 1),
  );
}

/** Nightscout's direction word for a change over five minutes, with `DemoCurve.direction`'s bands. */
export function demoDirection(deltaPerFiveMinutes: number): string {
  const perMinute = deltaPerFiveMinutes / 5;
  if (perMinute <= -3) return "DoubleDown";
  if (perMinute <= -2) return "SingleDown";
  if (perMinute <= -1) return "FortyFiveDown";
  if (perMinute < 1) return "Flat";
  if (perMinute < 2) return "FortyFiveUp";
  if (perMinute < 3) return "SingleUp";
  return "DoubleUp";
}

/** The newest `count` demo readings at `now`, newest first, like `NightscoutSource.latestEntries`. */
export function demoEntries(now: number, count: number): NightscoutEntry[] {
  const newest = Math.floor((now - DEMO_LAG_MS) / DEMO_INTERVAL_MS) * DEMO_INTERVAL_MS;
  return Array.from({ length: Math.max(0, count) }, (_, index) => {
    const date = newest - index * DEMO_INTERVAL_MS;
    const mgdl = demoMgdl(date);
    return { date, mgdl, direction: demoDirection(mgdl - demoMgdl(date - DEMO_INTERVAL_MS)) };
  });
}

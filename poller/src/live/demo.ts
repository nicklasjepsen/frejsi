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
 * Two slow waves around 125 mg/dL: a four-hour swing and a seventy-minute ripple, between about 67
 * and 183, so the demo shows in-range, low and high colours over an afternoon. Changes stay under
 * 2.5 mg/dL a minute, like a real sensor.
 */
export function demoMgdl(at: number): number {
  const minutes = at / 60_000;
  const value =
    125 + 42 * Math.sin((TWO_PI * minutes) / 240) + 16 * Math.sin((TWO_PI * minutes) / 70 + 1.3);
  return Math.round(Math.min(300, Math.max(50, value)));
}

/** Nightscout's direction word for a change over five minutes. */
export function demoDirection(deltaPerFiveMinutes: number): string {
  const perMinute = deltaPerFiveMinutes / 5;
  if (perMinute > 3) return "DoubleUp";
  if (perMinute > 2) return "SingleUp";
  if (perMinute > 1) return "FortyFiveUp";
  if (perMinute >= -1) return "Flat";
  if (perMinute >= -2) return "FortyFiveDown";
  if (perMinute >= -3) return "SingleDown";
  return "DoubleDown";
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

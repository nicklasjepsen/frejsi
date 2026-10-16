// What the sheet's two fields mean: the typed number in the space's unit and the time of day.
import type { GlucoseUnit } from "@frejsi/shared/schemas/index";

import { formatClock, withLocalTime } from "@/app/[locale]/(app)/log/time";
import { MANUAL_WINDOW_MS, toMmol } from "@/lib/readings/range";

/**
 * The number as typed: a decimal comma or point for mmol/L, digits only for mg/dL. null for
 * anything else or for a number that is no glucose value (the same range the route holds).
 */
export function parseTyped(text: string, unit: GlucoseUnit): number | null {
  const normal = text.trim().replace(",", ".");
  const pattern = unit === "mgdl" ? /^\d{1,4}$/ : /^\d{1,2}(\.\d{1,2})?$/;
  if (!pattern.test(normal)) return null;
  const value = Number(normal);
  return toMmol(value, unit) === null ? null : value;
}

/**
 * The most recent moment at or before `now` whose local time of day is `hhmm`: a time later than
 * the clock means yesterday's. null for a malformed time or one outside the last 24 hours.
 * Candidates come from every half hour of the last 26, one per local day they fall in, so a day
 * that is 23 or 25 hours long (daylight saving) cannot hide yesterday.
 */
export function resolveTime(hhmm: string, now: Date, timeZone: string): Date | null {
  const HALF_HOUR = 30 * 60_000;
  const earliest = now.getTime() - MANUAL_WINDOW_MS;
  let best: Date | null = null;
  for (let step = 0; step <= 52; step += 1) {
    const at = withLocalTime(new Date(now.getTime() - step * HALF_HOUR), hhmm, timeZone);
    if (!at) return null;
    // A time the clock skipped (spring forward) is normalised to the next one: refuse it rather
    // than store a different time than the one typed.
    if (formatClock(at, timeZone) !== hhmm) continue;
    const ms = at.getTime();
    if (ms <= now.getTime() && ms >= earliest && (!best || ms > best.getTime())) best = at;
  }
  return best;
}

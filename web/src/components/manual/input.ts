// What the sheet's two fields mean: the typed number in the space's unit and the time of day.
import type { GlucoseUnit } from "@frejsi/shared/schemas/index";

import { withLocalTime } from "@/app/[locale]/(app)/log/time";
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
 */
export function resolveTime(hhmm: string, now: Date, timeZone: string): Date | null {
  let at = withLocalTime(now, hhmm, timeZone);
  if (at && at.getTime() > now.getTime()) {
    at = withLocalTime(new Date(now.getTime() - MANUAL_WINDOW_MS), hhmm, timeZone);
  }
  if (!at || at.getTime() < now.getTime() - MANUAL_WINDOW_MS || at.getTime() > now.getTime()) {
    return null;
  }
  return at;
}

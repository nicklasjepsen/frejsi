// What a hand-typed glucose value may be, shared by the route and the entry sheet. Pure and
// browser-safe: only the units module of `shared`, never its barrel.
import { mgdlToMmol } from "@frejsi/shared/glucose/units";
import type { GlucoseUnit } from "@frejsi/shared/schemas/index";

/** A finger-prick can be entered up to this long after the measurement. */
export const MANUAL_WINDOW_MS = 24 * 60 * 60 * 1000;
/** And a clock that runs a little fast is forgiven, no more. */
export const MANUAL_FUTURE_MS = 5 * 60 * 1000;
/** Meters read "LO" below about 1.1 mmol/L and "HI" above 33.3; nothing outside this is a number. */
export const MANUAL_MIN_MMOL = 1;
export const MANUAL_MAX_MMOL = 40;

/** mmol/L with one decimal from what was typed; null when it is no glucose value. */
export function toMmol(value: number, unit: GlucoseUnit): number | null {
  const mmol = unit === "mgdl" ? mgdlToMmol(value) : Math.round(value * 10) / 10;
  return mmol >= MANUAL_MIN_MMOL && mmol <= MANUAL_MAX_MMOL ? mmol : null;
}


import type { Trend } from "../../schemas/glucose";

/**
 * Dexcom's trend thresholds in mg/dL per minute, converted from a rate in mmol/L per minute: the
 * arrow a Dexcom app would draw for that rate. Null when the rate is unknown.
 */
export function trendFromRate(mmolPerMinute: number | null): Trend {
  if (mmolPerMinute === null || !Number.isFinite(mmolPerMinute)) return "not-computable";
  const mgdlPerMinute = mmolPerMinute * 18.016;
  const magnitude = Math.abs(mgdlPerMinute);
  if (magnitude < 1) return "flat";
  if (magnitude < 2) return mgdlPerMinute > 0 ? "forty-five-up" : "forty-five-down";
  if (magnitude < 3) return mgdlPerMinute > 0 ? "single-up" : "single-down";
  return mgdlPerMinute > 0 ? "double-up" : "double-down";
}

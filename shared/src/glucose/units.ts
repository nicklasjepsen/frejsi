import type { GlucoseUnit } from "../schemas/glucose";

/** The spec's factor (§3): mg/dL ÷ 18.016 → mmol/L. */
export const MGDL_PER_MMOL = 18.016;

/** mg/dL → mmol/L with one decimal: `mgdlToMmol(100)` is `5.6`. */
export function mgdlToMmol(mgdl: number): number {
  return Math.round((mgdl / MGDL_PER_MMOL) * 10) / 10;
}

/** mmol/L → a whole mg/dL: `mmolToMgdl(5.6)` is `101`. */
export function mmolToMgdl(mmol: number): number {
  return Math.round(mmol * MGDL_PER_MMOL);
}

/** Readings are stored in mmol/L; `glucoseUnit` only changes rendering (plan decision 13). */
export function fromMmol(mmol: number, unit: GlucoseUnit): number {
  return unit === "mgdl" ? mmolToMgdl(mmol) : mmol;
}

import type { GlucoseUnit, Reading } from "@frejsi/shared/schemas/glucose";

import type { AppLocale } from "@/lib/i18n/routing";

import { formatGlucose } from "./format";

/** The detail of a symptom lists the readings this far either side of it (v0.6.0 plan §5). */
export const SYMPTOM_READINGS_MINUTES = 30;

/**
 * The readings from −30 to +30 minutes around `ts`, oldest first, each formatted with its
 * instant for `SymptomDetail` ("6,2 mmol/L"): a value never travels without its time. The
 * owner's and the carer's screens call this from the day data they already hold; a viewer's
 * screen never has readings to pass.
 */
export function readingsAround(
  ts: string,
  readings: readonly Pick<Reading, "ts" | "mmol">[],
  unit: GlucoseUnit,
  locale: AppLocale,
  unitLabel: string,
  minutes: number = SYMPTOM_READINGS_MINUTES,
): { ts: string; text: string }[] {
  const centre = new Date(ts).getTime();
  const span = minutes * 60_000;
  return [
    ...new Map(
      readings
        .filter((reading) => Math.abs(new Date(reading.ts).getTime() - centre) <= span)
        .map((reading) => [reading.ts, reading] as const),
    ).values(),
  ]
    .toSorted((a, b) => a.ts.localeCompare(b.ts))
    .map((reading) => ({
      ts: reading.ts,
      text: `${formatGlucose(reading.mmol, unit, locale)} ${unitLabel}`,
    }));
}

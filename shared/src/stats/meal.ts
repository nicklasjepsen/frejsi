import { type Reading } from "../schemas/glucose";
import { type MealStats, type Target } from "../schemas/history";
import { orderedReadings, timeInRange } from "./range";
import { MINUTE_MS, milliseconds, statsWindow, type Timestamp } from "./window";
export interface StatsMeal {
  ts: Timestamp;
  bolusTs?: Timestamp | null | undefined;
}
export function bolusLeadMinutes(meal: StatsMeal): number | undefined {
  return meal.bolusTs == null
    ? undefined
    : Math.round((milliseconds(meal.ts) - milliseconds(meal.bolusTs)) / MINUTE_MS);
}
export function mealStats(
  readings: readonly Reading[],
  meal: StatsMeal,
  target: Target,
  now: Timestamp,
): MealStats {
  const window = statsWindow(meal.ts, now);
  const end = Math.min(window.to.getTime(), milliseconds(now));
  const inside = orderedReadings(readings).filter(
    (reading) =>
      milliseconds(reading.ts) >= window.from.getTime() && milliseconds(reading.ts) <= end,
  );
  const peak = inside.reduce<Reading | undefined>(
    (highest, reading) => (!highest || reading.mmol > highest.mmol ? reading : highest),
    undefined,
  );
  const lead = bolusLeadMinutes(meal);
  return {
    ...(peak
      ? {
          peak: {
            mmol: peak.mmol,
            ts: peak.ts,
            minutesAfterMeal: Math.round(
              (milliseconds(peak.ts) - milliseconds(meal.ts)) / MINUTE_MS,
            ),
          },
        }
      : {}),
    inRange: timeInRange(readings, window, target, now),
    ...(lead === undefined ? {} : { bolusLeadMinutes: lead }),
    readingCount: inside.length,
  };
}

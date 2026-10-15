import { dayRange } from "../meals/day-range";
import { type Reading } from "../schemas/glucose";
import { type Target, type WeekNumbers } from "../schemas/history";
import { mealsInRange, type HistoryMeal } from "./day";
import { bolusLeadMinutes } from "./meal";
import { lowEpisodes, orderedReadings, timeInRange } from "./range";
import { MINUTE_MS, milliseconds, type TimeRange, type Timestamp } from "./window";

const DAY_MS = 86400000;
const dateAfter = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
/** ISO calendar arithmetic uses UTC dates; actual boundaries use the caller's timezone. End is exclusive. */
export function weekRange(
  date: string,
  timezone: string,
): { from: Date; to: Date; weekStart: string; weekEnd: string; isoWeek: number; isoYear: number } {
  dayRange(date, timezone); // Validate both arguments using the existing day contract.
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
  const weekStart = dateAfter(date, 1 - weekday),
    weekEnd = dateAfter(weekStart, 7);
  const thursday = dateAfter(weekStart, 3);
  const isoYear = Number(thursday.slice(0, 4));
  const isoWeek = Math.ceil(
    ((Date.parse(`${thursday}T00:00:00Z`) - Date.parse(`${isoYear}-01-01T00:00:00Z`)) / DAY_MS +
      1) /
      7,
  );
  return {
    from: dayRange(weekStart, timezone)[0],
    to: dayRange(weekEnd, timezone)[0],
    weekStart,
    weekEnd,
    isoWeek,
    isoYear,
  };
}
function localDate(ts: Timestamp, timezone: string): string {
  const parts = new Intl.DateTimeFormat(undefined, {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    calendar: "gregory",
    numberingSystem: "latn",
  }).formatToParts(new Date(ts));
  const part = (name: string) => parts.find((p) => p.type === name)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function weekStats({
  readings,
  previousWeekReadings,
  meals,
  target,
  weekRange: range,
  timezone,
  now,
}: {
  readings: readonly Reading[];
  previousWeekReadings: readonly Reading[];
  meals: readonly HistoryMeal[];
  target: Target;
  weekRange: TimeRange;
  timezone: string;
  now: Timestamp;
}): WeekNumbers {
  const inside = mealsInRange(meals, range, now);
  const current = timeInRange(readings, range, target, now);
  const previousStart = dateAfter(localDate(range.from, timezone), -7);
  const previous = timeInRange(
    previousWeekReadings,
    { from: dayRange(previousStart, timezone)[0], to: range.from },
    target,
    now,
  );
  const leads = inside.map(bolusLeadMinutes).filter((lead) => lead !== undefined);
  const observed = readings.filter(
    (reading) =>
      milliseconds(reading.ts) >= milliseconds(range.from) &&
      milliseconds(reading.ts) < milliseconds(range.to) &&
      milliseconds(reading.ts) <= milliseconds(now),
  );
  return {
    ...(current.coveredMinutes
      ? {
          inRangePercent: Math.round((current.minutes / current.coveredMinutes) * 100),
          belowPercent: Math.round((current.belowMinutes / current.coveredMinutes) * 100),
        }
      : {}),
    ...(previous.coveredMinutes
      ? {
          previousWeekInRangePercent: Math.round(
            (previous.minutes / previous.coveredMinutes) * 100,
          ),
        }
      : {}),
    lowEpisodes: lowEpisodes(observed, target, timezone),
    carbsPerDay: Math.round(inside.reduce((sum, meal) => sum + meal.totalCarbs, 0) / 7),
    mealCount: inside.length,
    bolusLead: {
      ...(leads.length
        ? { meanMinutes: Math.round(leads.reduce((sum, lead) => sum + lead, 0) / leads.length) }
        : {}),
      registered: leads.length,
      of: inside.length,
    },
  };
}
/**
 * Bucket timestamps mark their start. Pass the local day's start for non-whole-hour offsets.
 * On a long DST day, widen buckets by whole multiples to preserve all readings within 48 points.
 */
export function downsample(
  readings: readonly Reading[],
  bucketMinutes: number,
  from?: Timestamp,
): { ts: string; mmol: number }[] {
  if (!Number.isFinite(bucketMinutes) || bucketMinutes <= 0)
    throw new RangeError("Bucket size must be positive");
  const buckets = new Map<number, { sum: number; count: number }>();
  const ordered = orderedReadings(readings);
  const first = ordered[0],
    last = ordered.at(-1);
  if (!first || !last) return [];
  const baseWidth = bucketMinutes * MINUTE_MS;
  const anchor =
    from === undefined
      ? Math.floor(milliseconds(first.ts) / baseWidth) * baseWidth
      : milliseconds(from);
  let width = baseWidth;
  while (
    Math.floor((milliseconds(last.ts) - anchor) / width) -
      Math.floor((milliseconds(first.ts) - anchor) / width) +
      1 >
    48
  )
    width *= 2;
  for (const reading of ordered) {
    const start = anchor + Math.floor((milliseconds(reading.ts) - anchor) / width) * width;
    const bucket = buckets.get(start) ?? { sum: 0, count: 0 };
    bucket.sum += reading.mmol;
    bucket.count++;
    buckets.set(start, bucket);
  }
  return [...buckets].map(([start, bucket]) => ({
    ts: new Date(start).toISOString(),
    mmol: bucket.sum / bucket.count,
  }));
}

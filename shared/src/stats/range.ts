import { type Reading } from "../schemas/glucose";
import { type InRange, type Target } from "../schemas/history";
import {
  COVERAGE_CAP_MINUTES,
  MINUTE_MS,
  milliseconds,
  type TimeRange,
  type Timestamp,
} from "./window";

/** Readings are immutable; normalize a copy for callers with live merges or unordered queries. */
export function orderedReadings(readings: readonly Reading[]): Reading[] {
  return [...new Map(readings.map((reading) => [milliseconds(reading.ts), reading])).values()].sort(
    (a, b) => milliseconds(a.ts) - milliseconds(b.ts),
  );
}
export function timeInRange(
  readings: readonly Reading[],
  window: TimeRange,
  target: Target,
  now: Timestamp = window.to,
): InRange {
  const from = milliseconds(window.from),
    to = milliseconds(window.to);
  const end = Math.min(to, milliseconds(now));
  const result: InRange = {
    minutes: 0,
    coveredMinutes: 0,
    windowMinutes: Math.max(0, (to - from) / MINUTE_MS),
    complete: milliseconds(now) >= to,
    belowMinutes: 0,
    aboveMinutes: 0,
  };
  const ordered = orderedReadings(readings);
  for (let i = 0; i < ordered.length - 1; i++) {
    const reading = ordered[i],
      next = ordered[i + 1];
    if (!reading || !next) continue;
    const start = milliseconds(reading.ts),
      successor = milliseconds(next.ts);
    // A long gap contributes nothing, including the time just after its first reading.
    if (successor - start > COVERAGE_CAP_MINUTES * MINUTE_MS) continue;
    const covered = Math.max(0, (Math.min(successor, end) - Math.max(start, from)) / MINUTE_MS);
    result.coveredMinutes += covered;
    if (reading.mmol < target.low) result.belowMinutes += covered;
    else if (reading.mmol > target.high) result.aboveMinutes += covered;
    else result.minutes += covered;
  }
  return result;
}

/** Recovery needs thirty observed minutes at or above the lower bound; gaps do not prove recovery. */
export function lowEpisodes(
  readings: readonly Reading[],
  target: Target,
  timezone: string,
): { count: number; atNight: number } {
  const clock = new Intl.DateTimeFormat(undefined, {
    timeZone: timezone,
    hour: "numeric",
    hourCycle: "h23",
    numberingSystem: "latn",
  });
  let count = 0,
    atNight = 0,
    active = false;
  let recovered = 0;
  let previous: Reading | undefined;
  for (const reading of orderedReadings(readings)) {
    if (previous) {
      const elapsed = (milliseconds(reading.ts) - milliseconds(previous.ts)) / MINUTE_MS;
      if (elapsed <= COVERAGE_CAP_MINUTES && previous.mmol >= target.low) recovered += elapsed;
      else recovered = 0;
    }
    if (recovered >= 30) active = false;
    if (reading.mmol < target.low) {
      if (!active) {
        count++;
        const hour = Number(clock.format(new Date(reading.ts)));
        if (hour >= 22 || hour < 6) atNight++;
      }
      active = true;
      recovered = 0;
    }
    previous = reading;
  }
  return { count, atNight };
}

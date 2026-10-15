// Pure helpers behind the glucose components: the number in the space's unit, the age of a
// reading, staleness, the day's start in the space's timezone. No React, no strings: the
// components translate the parts these return.
import { fromMmol } from "@frejsi/shared/glucose/units";
import type { GlucoseUnit, Reading } from "@frejsi/shared/schemas/index";

import type { AppLocale } from "@/lib/i18n/routing";

/** After this long without a reading the status dot turns muted (plan §9). */
export const STALE_MINUTES = 15;
/** The age line re-renders this often (plan §9). */
export const AGE_TICK_MS = 30_000;
/** Consecutive readings further apart than this are drawn as separate curve segments (gap 5). */
export const GAP_MINUTES = 15;

const NUMBER_LOCALE: Record<AppLocale, string> = { da: "da-DK", en: "en-GB" };

/**
 * `6,2` in `da`, `6.2` in `en`, one decimal for mmol/L; a whole number for mg/dL (design gap 14).
 * Readings are stored in mmol and converted here, once (plan decision 13).
 */
export function formatGlucose(mmol: number, unit: GlucoseUnit, locale: AppLocale): string {
  const value = fromMmol(mmol, unit);
  const digits = unit === "mgdl" ? 0 : 1;
  return new Intl.NumberFormat(NUMBER_LOCALE[locale], {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

/** A target bound in the space's unit, without decimals when it has none ("4", "10", "3,9"). */
export function formatBound(mmol: number, unit: GlucoseUnit, locale: AppLocale): string {
  const value = fromMmol(mmol, unit);
  return new Intl.NumberFormat(NUMBER_LOCALE[locale], {
    minimumFractionDigits: 0,
    maximumFractionDigits: unit === "mgdl" ? 0 : 1,
  }).format(value);
}

export type Age =
  | { kind: "justNow" }
  | { kind: "minutes"; minutes: number }
  | { kind: "hours"; hours: number; minutes: number }
  | { kind: "overADay" };

/** Whole minutes between the reading and `now`; never negative (a clock a little ahead). */
export function ageMinutes(ts: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(ts).getTime()) / 60_000));
}

export function ageOf(ts: string, now: Date): Age {
  const minutes = ageMinutes(ts, now);
  if (minutes < 1) return { kind: "justNow" };
  if (minutes < 60) return { kind: "minutes", minutes };
  if (minutes < 24 * 60) {
    return { kind: "hours", hours: Math.floor(minutes / 60), minutes: minutes % 60 };
  }
  return { kind: "overADay" };
}

/** True when the latest reading is older than `STALE_MINUTES`, or when there is none. */
export function isStale(latest: Reading | null, now: Date): boolean {
  return !latest || ageMinutes(latest.ts, now) >= STALE_MINUTES;
}

/** "stiger langsomt" → "Stiger langsomt" for the desktop card's own line. */
export function capitalize(text: string, locale: AppLocale): string {
  const first = text.slice(0, 1).toLocaleUpperCase(NUMBER_LOCALE[locale]);
  return `${first}${text.slice(1)}`;
}

/** The calendar date and wall-clock time of `at` in `timeZone`. */
function zoned(at: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).formatToParts(new Date(at));
  const value = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

/** The zone's offset from UTC at `at`, in ms (positive east of Greenwich). */
function zoneOffsetMs(at: number, timeZone: string): number {
  const z = zoned(at, timeZone);
  return Date.UTC(z.year, z.month - 1, z.day, z.hour, z.minute, z.second) - at;
}

/**
 * The instant at which the wall clock in `timeZone` reads `hour`:00 on the given calendar date.
 * Two passes over the offset, so a date next to a daylight-saving change still lands on the
 * right hour.
 */
function zonedInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  timeZone: string,
): Date {
  const wall = Date.UTC(year, month - 1, day, hour);
  let guess = wall - zoneOffsetMs(wall, timeZone);
  guess = wall - zoneOffsetMs(guess, timeZone);
  return new Date(guess);
}

/**
 * The instant of `hour`:00 in `timeZone` on the day of `now` in that zone, or on the day before
 * when `now` is earlier than that hour; by calendar arithmetic, so a daylight-saving change does
 * not shift it. The desktop day curve starts at 06:00 (Nu-Desktop).
 */
export function dayStart(now: Date, timeZone: string, hour: number): Date {
  const today = zoned(now.getTime(), timeZone);
  const sameDay = zonedInstant(today.year, today.month, today.day, hour, timeZone);
  if (sameDay.getTime() <= now.getTime()) return sameDay;
  const yesterday = new Date(Date.UTC(today.year, today.month - 1, today.day - 1));
  return zonedInstant(
    yesterday.getUTCFullYear(),
    yesterday.getUTCMonth() + 1,
    yesterday.getUTCDate(),
    hour,
    timeZone,
  );
}

/** "Onsdag 14. oktober" under the desktop title, in the space's zone. */
export function formatDayTitle(now: Date, timeZone: string, locale: AppLocale): string {
  const text = new Intl.DateTimeFormat(NUMBER_LOCALE[locale], {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone,
  }).format(now);
  return capitalize(text, locale);
}

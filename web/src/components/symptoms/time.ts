import { formatClock } from "@/lib/i18n/time";

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const AHEAD_MS = 10 * MINUTE_MS;

function offsetMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const p = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  const asUtc = Date.UTC(p("year"), p("month") - 1, p("day"), p("hour"), p("minute"), p("second"));
  return Math.round((asUtc - at.getTime()) / MINUTE_MS);
}

interface LocalDate {
  year: number;
  month: number;
  day: number;
}
function localDate(at: Date, timeZone: string): LocalDate {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const p = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  return { year: p("year"), month: p("month"), day: p("day") };
}
/** The calendar date before `date`, by the calendar alone. */
function dayBefore(date: LocalDate): LocalDate {
  const previous = new Date(Date.UTC(date.year, date.month - 1, date.day) - DAY_MS);
  return { year: previous.getUTCFullYear(), month: previous.getUTCMonth() + 1, day: previous.getUTCDate() };
}
/** `HH:MM` on `date` in the zone when the clock does not land on it (the spring gap): two passes settle the offset. */
function resolveLoose(date: LocalDate, hours: number, minutes: number, timeZone: string): number {
  const wall = Date.UTC(date.year, date.month - 1, date.day, hours, minutes);
  let guess = wall;
  for (let i = 0; i < 2; i++) guess = wall - offsetMinutes(new Date(guess), timeZone) * MINUTE_MS;
  return guess;
}
/**
 * Every instant whose wall clock in the zone reads `HH:MM` on `date`, earliest first: one on an
 * ordinary day, two in the hour that repeats when summer time ends, none in the hour that is
 * skipped when it starts. The offsets a day either side of the date cover a change on the date.
 */
function occurrences(date: LocalDate, hours: number, minutes: number, timeZone: string): number[] {
  const wall = Date.UTC(date.year, date.month - 1, date.day, hours, minutes);
  const offsets = new Set<number>();
  for (const probe of [wall - DAY_MS, wall, wall + DAY_MS])
    offsets.add(offsetMinutes(new Date(probe), timeZone));
  const found = new Set<number>();
  for (const offset of offsets) {
    const instant = wall - offset * MINUTE_MS;
    if (offsetMinutes(new Date(instant), timeZone) === offset) found.add(instant);
  }
  return [...found].sort((a, b) => a - b);
}
/**
 * The latest occurrence of `HH:MM` on `date` that is not more than ten minutes ahead of `now`, or
 * null. A time the clock skipped that day resolves loosely on that day before yesterday is tried.
 */
function latestNotAhead(
  date: LocalDate,
  hours: number,
  minutes: number,
  timeZone: string,
  now: Date,
): number | null {
  const limit = now.getTime() + AHEAD_MS;
  const exact = occurrences(date, hours, minutes, timeZone);
  const candidates = exact.length > 0 ? exact : [resolveLoose(date, hours, minutes, timeZone)];
  const past = candidates.filter((instant) => instant <= limit);
  return past.length > 0 ? (past[past.length - 1] ?? null) : null;
}

/**
 * The instant of `HH:MM` on today's date in the space's zone, as the time field means it: the
 * most recent one not more than ten minutes ahead of `now`, so "23:50" typed at 00:10 is last
 * night, not tonight. Yesterday is resolved on its own date, with its own offset. In the hour that
 * repeats when summer time ends, the occurrence that has already passed wins, so "02:10" typed at
 * 02:15 on the first pass is five minutes ago, not a day ago.
 */
export function instantOfLocalTime(hhmm: string, timeZone: string, now: Date): Date | null {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  const today = localDate(now, timeZone);
  const yesterday = dayBefore(today);
  const instant =
    latestNotAhead(today, hours, minutes, timeZone, now) ??
    latestNotAhead(yesterday, hours, minutes, timeZone, now) ??
    resolveLoose(yesterday, hours, minutes, timeZone);
  return new Date(instant);
}

/** `HH:MM` of `at` in the zone, for the time field's value. */
export const localClock = (at: Date, timeZone: string): string => formatClock(at, timeZone);

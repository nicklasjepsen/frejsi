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
/** `HH:MM` on `date` in the zone; two passes settle the offset on a day with a clock change. */
function resolve(date: LocalDate, hours: number, minutes: number, timeZone: string): number {
  const wall = Date.UTC(date.year, date.month - 1, date.day, hours, minutes);
  let guess = wall;
  for (let i = 0; i < 2; i++) guess = wall - offsetMinutes(new Date(guess), timeZone) * MINUTE_MS;
  return guess;
}

/**
 * The instant of `HH:MM` on today's date in the space's zone, as the time field means it: the
 * most recent one not more than ten minutes ahead of `now`, so "23:50" typed at 00:10 is last
 * night, not tonight. Yesterday is resolved on its own date, with its own offset.
 */
export function instantOfLocalTime(hhmm: string, timeZone: string, now: Date): Date | null {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  const today = localDate(now, timeZone);
  let instant = resolve(today, hours, minutes, timeZone);
  if (instant > now.getTime() + AHEAD_MS) instant = resolve(dayBefore(today), hours, minutes, timeZone);
  return new Date(instant);
}

/** `HH:MM` of `at` in the zone, for the time field's value. */
export const localClock = (at: Date, timeZone: string): string => formatClock(at, timeZone);

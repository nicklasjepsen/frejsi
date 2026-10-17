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
const pad = (n: number, width = 2) => String(n).padStart(width, "0");
const dayKey = (date: LocalDate): string => `${pad(date.year, 4)}-${pad(date.month)}-${pad(date.day)}`;

/**
 * The local dates the sheet offers, today first: today and the six days before it in the space's
 * zone, so every time on them is inside the route's seven-day window.
 */
export function recentDays(now: Date, timeZone: string, count = 7): string[] {
  const days: string[] = [];
  let date = localDate(now, timeZone);
  for (let i = 0; i < count; i++) {
    days.push(dayKey(date));
    date = dayBefore(date);
  }
  return days;
}

/**
 * The instant whose wall clock in the zone reads `HH:MM` on the local date `YYYY-MM-DD`, or null
 * for nonsense. In the hour that repeats when summer time ends, the occurrence that has already
 * passed wins, so "02:10" typed at 02:15 on the second pass is five minutes ago, not an hour. A
 * time the clock skipped lands on the clock after the jump. The result may lie ahead of `now`;
 * `isAhead` says when it is too far ahead to log.
 */
export function instantOn(day: string, hhmm: string, timeZone: string, now: Date): Date | null {
  const dayMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  const clock = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!dayMatch || !clock) return null;
  const hours = Number(clock[1]);
  const minutes = Number(clock[2]);
  if (hours > 23 || minutes > 59) return null;
  const date = { year: Number(dayMatch[1]), month: Number(dayMatch[2]), day: Number(dayMatch[3]) };
  const exact = occurrences(date, hours, minutes, timeZone);
  const candidates = exact.length > 0 ? exact : [resolveLoose(date, hours, minutes, timeZone)];
  const limit = now.getTime() + AHEAD_MS;
  const passed = candidates.filter((instant) => instant <= limit);
  const chosen = passed.length > 0 ? passed[passed.length - 1] : candidates[0];
  return chosen === undefined ? null : new Date(chosen);
}

/** More than ten minutes ahead of now: the route refuses it, a feeling is logged as it happens. */
export const isAhead = (at: Date, now: Date): boolean => at.getTime() - now.getTime() > AHEAD_MS;

/** Whether `at` falls on today, yesterday or an earlier day in the space's zone. */
export function dayOf(at: Date, now: Date, timeZone: string): "today" | "yesterday" | "earlier" {
  const day = dayKey(localDate(at, timeZone));
  const today = localDate(now, timeZone);
  if (day === dayKey(today)) return "today";
  return day === dayKey(dayBefore(today)) ? "yesterday" : "earlier";
}

/** "tirsdag 13. oktober" for a local date, in the session's language. */
export function longDay(day: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(`${day}T12:00:00.000Z`));
}

/** `HH:MM` of `at` in the zone, for the time field's value. */
export const localClock = (at: Date, timeZone: string): string => formatClock(at, timeZone);

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

/**
 * The instant of `HH:MM` on today's date in the space's zone, as the time field means it: the
 * most recent one not more than ten minutes ahead of `now`, so "23:50" typed at 00:10 is last
 * night, not tonight.
 */
export function instantOfLocalTime(hhmm: string, timeZone: string, now: Date): Date | null {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  const local = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const p = (type: string) => Number(local.find((part) => part.type === type)?.value ?? "0");
  let guess = Date.UTC(p("year"), p("month") - 1, p("day"), hours, minutes);
  // Two passes settle the offset on a day with a clock change.
  for (let i = 0; i < 2; i++) {
    const offset = offsetMinutes(new Date(guess), timeZone);
    guess = Date.UTC(p("year"), p("month") - 1, p("day"), hours, minutes) - offset * MINUTE_MS;
  }
  if (guess > now.getTime() + AHEAD_MS) guess -= DAY_MS;
  return new Date(guess);
}

/** `HH:MM` of `at` in the zone, for the time field's value. */
export const localClock = (at: Date, timeZone: string): string => formatClock(at, timeZone);

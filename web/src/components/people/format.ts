// Pure formatting behind the People screen: "Sidst set", "udløber om N dage" and the devices
// column. Every clock is in the space's zone (plan: the runtime zone differs between server and
// browser) and every day boundary is a calendar day in that zone.
import { formatClock } from "@/lib/i18n/time";
import type { AppLocale } from "@/lib/i18n/routing";

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
/** "Nu" for a person seen this recently (Personer-Desktop draws Jonas as "Nu"). */
export const NOW_WINDOW_MS = 5 * MINUTE_MS;

export type LastSeen =
  | { kind: "never" }
  | { kind: "now" }
  | { kind: "today"; time: string }
  | { kind: "yesterday"; time: string }
  | { kind: "weekday"; label: string }
  | { kind: "date"; label: string };

/** The calendar day of `at` in `timeZone` as a day number, so two instants compare by date. */
function dayNumber(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const read = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return Math.round(Date.UTC(read("year"), read("month") - 1, read("day")) / DAY_MS);
}

/** Calendar days from `from` to `to` in the zone: 23:30 to 00:30 across midnight is one day. */
export function calendarDaysBetween(from: Date, to: Date, timeZone: string): number {
  return dayNumber(to, timeZone) - dayNumber(from, timeZone);
}

/** Whole days until `expiresAt`, floored; a link that dies later today has 0. */
export function daysLeft(expiresAt: Date, now: Date): number {
  return Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / DAY_MS));
}

/**
 * How People says when someone was last seen: now, a clock today or yesterday, the weekday
 * within the week, else a short date. Weekday and date come from Intl in the user's language;
 * Danish writes them lowercase, so the table capitalizes.
 */
export function describeLastSeen(
  at: Date | null,
  now: Date,
  timeZone: string,
  locale: AppLocale,
): LastSeen {
  if (!at) return { kind: "never" };
  if (now.getTime() - at.getTime() < NOW_WINDOW_MS) return { kind: "now" };
  const days = calendarDaysBetween(at, now, timeZone);
  if (days <= 0) return { kind: "today", time: formatClock(at, timeZone) };
  if (days === 1) return { kind: "yesterday", time: formatClock(at, timeZone) };
  if (days < 7) {
    return {
      kind: "weekday",
      label: new Intl.DateTimeFormat(locale, { weekday: "long", timeZone }).format(at),
    };
  }
  return {
    kind: "date",
    label: new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone }).format(at),
  };
}

/** "iPhone · Mac" when every device has a name; null means "show the count instead". */
export function deviceSummary(devices: { name: string | null }[]): string | null {
  if (devices.length === 0) return null;
  const names = devices.map((d) => d.name);
  return names.every((n): n is string => typeof n === "string" && n.trim() !== "")
    ? names.join(" · ")
    : null;
}

export function capitalize(text: string): string {
  return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}

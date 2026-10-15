import { z } from "zod";
import { localDateOf } from "@/components/day/format";
import type { AppLocale } from "@/lib/i18n/routing";

export const dateAfter = (date: string, days: number): string => {
  const at = new Date(`${date}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
};

export function mondayOf(date: string): string {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return dateAfter(date, -((weekday + 6) % 7));
}

export function selectedWeek(start: string | undefined, timezone: string, now: Date): string {
  const current = mondayOf(localDateOf(now, timezone));
  return start && z.iso.date().safeParse(start).success
    ? ([mondayOf(start), current].sort()[0] ?? current)
    : current;
}

export const dateLocale = (locale: AppLocale) => (locale === "da" ? "da-DK" : "en-GB");

/** These are local calendar dates already; UTC preserves them across browser timezones. */
export function weekDateLabel(start: string, locale: AppLocale): string {
  const end = dateAfter(start, 6);
  const formatter = new Intl.DateTimeFormat(dateLocale(locale), {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    ...(start.slice(0, 4) !== end.slice(0, 4) ? { year: "numeric" as const } : {}),
  });
  return formatter.formatRange(new Date(`${start}T12:00:00Z`), new Date(`${end}T12:00:00Z`));
}

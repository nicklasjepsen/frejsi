import { formatDayDate } from "@/components/day/format";
import type { AppLocale } from "@/lib/i18n/routing";

export function shiftDate(date: string, days: number): string {
  const at = new Date(`${date}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

export function dayHeading(date: string, locale: AppLocale): string {
  const text = formatDayDate(date, locale);
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
}

export function validDate(date: unknown, today: string): date is string {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) return false;
  const parsed = new Date(`${date}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

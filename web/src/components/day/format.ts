// Formatting for the day: no glucose module is imported here, so nothing of glucose can reach a
// viewer's screen through this folder (plan §7, task 8).
import type { AppLocale } from "@/lib/i18n/routing";

const DATE_LOCALE: Record<AppLocale, string> = { da: "da-DK", en: "en-GB" };

/**
 * "onsdag 14. oktober" for the local date `YYYY-MM-DD` the day route answered. The date is a
 * calendar day already, so it is formatted at noon UTC in UTC: no zone can move it to a neighbour.
 */
export function formatDayDate(date: string, locale: AppLocale): string {
  return new Intl.DateTimeFormat(DATE_LOCALE[locale], {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

/** "Jonas eller Mette": whom a viewer can ask, from the owners' names. */
export function formatAskList(names: string[], locale: AppLocale): string {
  return new Intl.ListFormat(DATE_LOCALE[locale], { style: "long", type: "disjunction" }).format(
    names,
  );
}

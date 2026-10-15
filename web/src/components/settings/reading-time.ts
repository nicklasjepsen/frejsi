import type { AppLocale } from "@/lib/i18n/routing";

const dayKey = (at: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).format(at);

/** Whether two instants fall on the same calendar day in the space's zone ("sidste måling i dag"). */
export function sameDay(a: Date, b: Date, timeZone: string): boolean {
  return dayKey(a, timeZone) === dayKey(b, timeZone);
}

/** A short day for another day's reading: "14. okt." in da, "14 Oct" in en. */
export function formatDay(at: Date, timeZone: string, locale: AppLocale): string {
  return new Intl.DateTimeFormat(locale === "da" ? "da-DK" : "en-GB", {
    day: "numeric",
    month: "short",
    timeZone,
  }).format(at);
}

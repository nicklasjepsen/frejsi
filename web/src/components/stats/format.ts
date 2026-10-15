// Durations as the artboards write them (plan §8): "1 t 05 min" / "50 min" in phone tiles and the
// Now "Top" column, the short "1 t 05" in desktop footnotes and "3 t 00" in tables.
import type { useTranslations } from "next-intl";

import type { AppLocale } from "@/lib/i18n/routing";

type StatsT = ReturnType<typeof useTranslations<"stats">>;

export type DurationStyle = "long" | "short" | "table";

const pad = (n: number) => String(n).padStart(2, "0");

export function formatDuration(t: StatsT, totalMinutes: number, style: DurationStyle): string {
  const minutes = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (style === "table") return t("duration.short", { hours, minutes: pad(rest) });
  if (hours === 0) return t("duration.minutes", { minutes: rest });
  if (style === "long" && rest === 0) return t("duration.hours", { hours });
  return style === "short"
    ? t("duration.short", { hours, minutes: pad(rest) })
    : t("duration.hoursMinutes", { hours, minutes: pad(rest) });
}

const LOCALE_TAG: Record<AppLocale, string> = { da: "da-DK", en: "en-GB" };

/** The calendar day of `at` in `timeZone`, as `YYYY-MM-DD`. */
function localDate(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).format(at);
}

/**
 * "I dag" / "I går" for today and yesterday in the space's zone, otherwise the short weekday and
 * date through Intl ("Ons. 7. okt.", "Wed 7 Oct"), never string-built.
 */
export function relativeDay(
  t: StatsT,
  ts: string,
  now: Date,
  timeZone: string,
  locale: AppLocale,
): string {
  const at = new Date(ts);
  const day = localDate(at, timeZone);
  if (day === localDate(now, timeZone)) return t("today");
  const yesterday = new Date(`${localDate(now, timeZone)}T12:00:00.000Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  if (day === yesterday.toISOString().slice(0, 10)) return t("yesterday");
  const text = new Intl.DateTimeFormat(LOCALE_TAG[locale], {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone,
  }).format(at);
  return `${text.slice(0, 1).toLocaleUpperCase(LOCALE_TAG[locale])}${text.slice(1)}`;
}

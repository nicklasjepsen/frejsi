// The wording of this screen's numbers (v0.3.0 plan §8): durations through the `stats.*` keys,
// the header lines through Intl in the space's timezone. Nothing is string-built from Danish.
import type { useTranslations } from "next-intl";

import { formatDayTitle } from "@/components/glucose/format";
import { formatDuration, relativeDay, type DurationStyle } from "@/components/stats/format";
import type { AppLocale } from "@/lib/i18n/routing";
import { formatClock } from "@/lib/i18n/time";

type StatsT = ReturnType<typeof useTranslations<"stats">>;
type DetailT = ReturnType<typeof useTranslations<"mealDetail">>;

/** "3 t" for whole hours (as drawn in the tiles), else "1 t 20 min" / "1 t 20" / "45 min". */
export function tileDuration(t: StatsT, minutes: number, style: DurationStyle): string {
  const whole = Math.max(0, Math.round(minutes));
  if (whole > 0 && whole % 60 === 0) return t("duration.hours", { hours: whole / 60 });
  return formatDuration(t, whole, style);
}

/** The header lines' meal: `fromPump` while the pump record made it and nobody has ticked it. */
interface MetaMeal {
  ts: string;
  byUser: { name: string };
  fromPump?: true | undefined;
}

/**
 * Maaltid-Telefon: "I dag 12:10 · Jonas" ("I går", else the short weekday and date); "I dag 11:50 ·
 * fra pumpen" for an untouched pump meal, which nobody logged (#244).
 */
export function phoneMeta(
  t: DetailT,
  stats: StatsT,
  meal: MetaMeal,
  now: Date,
  timeZone: string,
  locale: AppLocale,
): string {
  const day = relativeDay(stats, meal.ts, now, timeZone, locale);
  const time = formatClock(new Date(meal.ts), timeZone);
  if (meal.fromPump) return t("metaPhonePump", { day, time });
  return t("metaPhone", { day, time, name: meal.byUser.name });
}

/**
 * Maaltid-Desktop: "Onsdag 14. oktober · 12:10 · logget af Jonas"; "… · fra pumpen" for an
 * untouched pump meal (#244).
 */
export function desktopMeta(
  t: DetailT,
  meal: MetaMeal,
  timeZone: string,
  locale: AppLocale,
): string {
  const at = new Date(meal.ts);
  const date = formatDayTitle(at, timeZone, locale);
  const time = formatClock(at, timeZone);
  if (meal.fromPump) return t("metaDesktopPump", { date, time });
  return t("metaDesktop", { date, time, name: meal.byUser.name });
}

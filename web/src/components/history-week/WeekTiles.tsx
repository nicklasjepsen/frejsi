"use client";
import type { WeekHistoryView } from "@frejsi/shared/schemas/history";
import { dayRange } from "@frejsi/shared/meals/day-range";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { GlucoseChart } from "@/components/glucose/GlucoseChart";
import { localeHref, type AppLocale } from "@/lib/i18n/routing";
import { dateLocale } from "./dates";
import styles from "./history-week.module.css";

/** The one-column phone tile's viewBox width: it stretches to the card (Historik-Desktop: 120). */
const PHONE_TILE_WIDTH = 320;

export function WeekTiles({
  week,
  locale,
  desktop = false,
}: {
  week: WeekHistoryView;
  locale: AppLocale;
  /** From 1280 px the seven tiles share a row at the design's 120×64. */
  desktop?: boolean;
}) {
  const t = useTranslations("historyWeek");
  const formatter = new Intl.DateTimeFormat(dateLocale(locale), {
    weekday: "short",
    day: "numeric",
    timeZone: week.timezone,
  });
  return (
    <section className={styles.days} aria-label={t("days")}>
      {week.days.map((day) => {
        const [from, to] = dayRange(day.date, week.timezone);
        const date = formatter.format(from);
        const heading = date.charAt(0).toLocaleUpperCase(dateLocale(locale)) + date.slice(1);
        return (
          <Link
            className={styles.dayTile}
            key={day.date}
            href={localeHref(locale, `/history?date=${day.date}`)}
          >
            <div className={styles.tileLine}>
              <strong>{heading}</strong>
              <span>{t("mealCount", { count: day.mealCount })}</span>
            </div>
            <GlucoseChart
              variant="week-tile"
              {...(desktop ? {} : { width: PHONE_TILE_WIDTH })}
              curve={day.curve}
              mealTimes={day.mealTimes}
              from={from}
              to={to}
              target={week.target}
              timeZone={week.timezone}
            />
            <div className={styles.tileLine}>
              <span>{t("grams", { grams: day.totalCarbs })}</span>
              <span>
                {t("inRange", {
                  percent:
                    day.inRangePercent === undefined
                      ? t("missing")
                      : t("percent", { value: day.inRangePercent }),
                })}
              </span>
            </div>
          </Link>
        );
      })}
    </section>
  );
}

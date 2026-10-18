"use client";
import type { GlucoseUnit } from "@frejsi/shared/schemas/index";
import type { WeekHistoryView } from "@frejsi/shared/schemas/history";
import type { SymptomView } from "@frejsi/shared/schemas/symptom";
import { dayRange } from "@frejsi/shared/meals/day-range";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { GlucoseChart } from "@/components/glucose/GlucoseChart";
import { localeHref, type AppLocale } from "@/lib/i18n/routing";
import { dateLocale } from "./dates";
import styles from "./history-week.module.css";

/** The one-column phone tile's viewBox width: it stretches to the card (Historik-Desktop: 120). */
const PHONE_TILE_WIDTH = 320;

/** The symptoms of the week grouped onto the local day each falls in. */
export function symptomsByDay(
  week: Pick<WeekHistoryView, "days" | "timezone">,
  symptoms: readonly SymptomView[],
): Map<string, SymptomView[]> {
  const byDay = new Map<string, SymptomView[]>();
  for (const day of week.days) {
    const [from, to] = dayRange(day.date, week.timezone);
    byDay.set(
      day.date,
      symptoms.filter((symptom) => {
        const t = new Date(symptom.ts).getTime();
        return t >= from.getTime() && t < to.getTime();
      }),
    );
  }
  return byDay;
}

export function WeekTiles({
  week,
  locale,
  desktop = false,
  symptoms = [],
  onlyWithSymptoms = false,
  onSymptomTap,
  symptomLabel = (kind) => kind,
  unit,
}: {
  week: WeekHistoryView;
  locale: AppLocale;
  /** From 1280 px the seven tiles share a row at the design's 120×64. */
  desktop?: boolean;
  /** The week's symptoms (v0.6.0 plan §5): a diamond under each day's meals. */
  symptoms?: readonly SymptomView[];
  /** The "Symptomer" filter: only the days with a symptom. */
  onlyWithSymptoms?: boolean;
  onSymptomTap?: (id: string) => void;
  symptomLabel?: (kind: string) => string;
  /** The space's unit: with it, each tile's tooltip reads the day's curve under the pointer. */
  unit?: GlucoseUnit;
}) {
  const t = useTranslations("historyWeek");
  const history = useTranslations("history");
  const formatter = new Intl.DateTimeFormat(dateLocale(locale), {
    weekday: "short",
    day: "numeric",
    timeZone: week.timezone,
  });
  const byDay = symptomsByDay(week, symptoms);
  const days = onlyWithSymptoms
    ? week.days.filter((day) => (byDay.get(day.date)?.length ?? 0) > 0)
    : week.days;
  if (days.length === 0) return <p className={styles.emptyWeek}>{history("noSymptomsWeek")}</p>;
  return (
    <section className={styles.days} aria-label={t("days")}>
      {days.map((day) => {
        const [from, to] = dayRange(day.date, week.timezone);
        const date = formatter.format(from);
        const heading = date.charAt(0).toLocaleUpperCase(dateLocale(locale)) + date.slice(1);
        // The heading's link is stretched over the tile; the symptom tap targets sit above it,
        // so no button is nested in the link. The chart reads the pointer over the whole tile
        // (`data-chart-hover`) for its tooltip, and a click still goes to the link.
        return (
          <div className={styles.dayTile} key={day.date} data-date={day.date} data-chart-hover="">
            <Link
              className={styles.tileLink}
              href={localeHref(locale, `/history?date=${day.date}`)}
            >
              <span className={styles.tileLine}>
                <strong>{heading}</strong>
                <span>{t("mealCount", { count: day.mealCount })}</span>
              </span>
            </Link>
            <div className={styles.tileChart}>
              <GlucoseChart
                variant="week-tile"
                {...(desktop ? {} : { width: PHONE_TILE_WIDTH })}
                curve={day.curve}
                mealTimes={day.mealTimes}
                {...(day.meals.length > 0 ? { meals: day.meals } : {})}
                symptoms={(byDay.get(day.date) ?? []).map((symptom) => ({
                  id: symptom.id,
                  ts: symptom.ts,
                  kind: symptom.kind,
                  label: symptomLabel(symptom.kind),
                }))}
                {...(onSymptomTap ? { onSymptomTap } : {})}
                from={from}
                to={to}
                target={week.target}
                timeZone={week.timezone}
                {...(unit ? { tooltip: { unit } } : {})}
              />
            </div>
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
          </div>
        );
      })}
    </section>
  );
}

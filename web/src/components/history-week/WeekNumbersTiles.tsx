"use client";
import type { GlucoseUnit } from "@frejsi/shared/schemas/glucose";
import type { WeekHistoryView } from "@frejsi/shared/schemas/history";
import { useTranslations } from "next-intl";
import { formatBound } from "@/components/glucose/format";
import { StatGrid, StatTile } from "@/components/stats/StatTile";
import { Notice } from "@/components/ui/Notice";
import type { AppLocale } from "@/lib/i18n/routing";
import styles from "./history-week.module.css";

export function WeekNumbersTiles({
  week,
  unit,
  locale,
}: {
  week: WeekHistoryView;
  unit: GlucoseUnit;
  locale: AppLocale;
}) {
  const t = useTranslations("historyWeek");
  const n = week.numbers;
  const empty = n.mealCount === 0;
  const missing = t("missing");
  const percent = (value?: number) =>
    empty || value === undefined ? missing : t("percent", { value });
  const { count, atNight } = n.lowEpisodes;
  // "0 %" over "5 gange" contradicts itself: a share that rounds to nothing is "< 1 %" when
  // there were episodes at all.
  const below = n.belowPercent === 0 && count > 0 ? t("belowOnePercent") : percent(n.belowPercent);
  const episodes =
    count === 0
      ? t("none")
      : count === atNight
        ? t("allNight", { count })
        : t("someNight", { count, night: atNight });
  const mean = n.bolusLead.meanMinutes;
  return (
    <section className={styles.numbers} aria-labelledby="week-numbers-title">
      <h2 id="week-numbers-title">{t("numbers")}</h2>
      <StatGrid columns={2}>
        <StatTile
          size="week"
          label={t("rangeLabel", {
            low: formatBound(week.target.low, unit, locale),
            high: formatBound(week.target.high, unit, locale),
          })}
          value={percent(n.inRangePercent)}
          {...(!empty
            ? { footnote: t("previousWeek", { percent: percent(n.previousWeekInRangePercent) }) }
            : {})}
        />
        <StatTile
          size="week"
          label={t("belowLabel", { low: formatBound(week.target.low, unit, locale) })}
          value={below}
          {...(!empty ? { footnote: n.belowPercent === undefined ? missing : episodes } : {})}
        />
        <StatTile
          size="week"
          label={t("carbsPerDay")}
          value={empty ? missing : t("grams", { grams: n.carbsPerDay })}
          {...(!empty ? { footnote: t("totalMeals", { count: n.mealCount }) } : {})}
        />
        <StatTile
          size="week"
          label={t("bolusBefore")}
          value={
            empty || mean === undefined
              ? missing
              : mean < 0
                ? t("afterMeal", { minutes: -mean })
                : t("minutes", { minutes: mean })
          }
          {...(!empty
            ? {
                footnote: t("registered", {
                  registered: n.bolusLead.registered,
                  total: n.bolusLead.of,
                }),
              }
            : {})}
        />
      </StatGrid>
      <Notice>{t("notice")}</Notice>
    </section>
  );
}

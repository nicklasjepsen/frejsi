"use client";
import type { GlucoseUnit } from "@frejsi/shared/schemas/glucose";
import type { WeekHistoryView } from "@frejsi/shared/schemas/history";
import { useTranslations } from "next-intl";
import { MealStatsTable } from "@/components/stats/MealStatsTable";
import styles from "./history-week.module.css";

export function WeekMealsTable({
  week,
  unit,
  onOpen,
}: {
  week: WeekHistoryView;
  unit: GlucoseUnit;
  onOpen: (id: string) => void;
}) {
  const t = useTranslations("historyWeek");
  return (
    <section className={styles.meals} aria-label={t("meals")}>
      <MealStatsTable
        rows={[...week.meals]
          .sort((a, b) => b.ts.localeCompare(a.ts))
          .map((row) => ({
            mealId: row.mealId,
            ts: row.ts,
            title: row.title,
            totalCarbs: row.totalCarbs,
            ...(row.bolusLeadMinutes === undefined
              ? {}
              : { bolusLeadMinutes: row.bolusLeadMinutes }),
            stats: {
              inRange: row.stats.inRange,
              readingCount: row.stats.readingCount,
              ...(row.stats.peak === undefined ? {} : { peak: row.stats.peak }),
              ...(row.stats.bolusLeadMinutes === undefined
                ? {}
                : { bolusLeadMinutes: row.stats.bolusLeadMinutes }),
            },
          }))}
        unit={unit}
        timeZone={week.timezone}
        now={new Date(week.now)}
        onOpen={onOpen}
        caption={t("meals")}
      />
    </section>
  );
}

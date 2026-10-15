"use client";

import type { GlucoseUnit } from "@frejsi/shared/schemas/glucose";
import type { MealCurveView } from "@frejsi/shared/schemas/history";
import { useTranslations } from "next-intl";

import { MealStatsTable } from "@/components/stats/MealStatsTable";

import styles from "./meal-detail.module.css";

export function CompareSection({
  view,
  stats,
  unit,
  timeZone,
  now,
  onOpen,
}: {
  view: MealCurveView;
  stats: MealCurveView["stats"];
  unit: GlucoseUnit;
  timeZone: string;
  now: Date;
  onOpen: (id: string) => void;
}) {
  const t = useTranslations("mealDetail.compare");
  if (!view.previous.length) return null;
  const tableStats = (value: MealCurveView["stats"]) => ({
    inRange: value.inRange,
    readingCount: value.readingCount,
    ...(value.peak === undefined ? {} : { peak: value.peak }),
    ...(value.bolusLeadMinutes === undefined ? {} : { bolusLeadMinutes: value.bolusLeadMinutes }),
  });
  const rows = [
    {
      mealId: view.meal.id,
      ts: view.meal.ts,
      title: view.meal.title,
      totalCarbs: view.meal.totalCarbs,
      stats: tableStats(stats),
      ...(stats.bolusLeadMinutes === undefined ? {} : { bolusLeadMinutes: stats.bolusLeadMinutes }),
    },
    ...view.previous.map(({ bolusLeadMinutes, stats: previousStats, ...row }) => ({
      ...row,
      stats: tableStats(previousStats),
      ...(bolusLeadMinutes === undefined ? {} : { bolusLeadMinutes }),
    })),
  ];
  return (
    <section className={styles.compareSection}>
      <MealStatsTable
        rows={rows}
        currentMealId={view.meal.id}
        unit={unit}
        timeZone={timeZone}
        now={now}
        caption={t("title", { count: view.previous.length, title: view.meal.title })}
        onOpen={onOpen}
      />
    </section>
  );
}

"use client";

import type { GlucoseUnit } from "@frejsi/shared";
import { useLocale, useTranslations } from "next-intl";

import { DataTable, type DataColumn } from "@/components/ui";
import { resolveLocale } from "@/lib/i18n/routing";
import { formatClock } from "@/lib/i18n/time";

import { formatDuration, relativeDay } from "./format";
import { PeakValue } from "./PeakValue";
import type { MealStatsRow } from "./types";

export interface MealStatsTableProps {
  rows: readonly MealStatsRow[];
  /** The meal on screen, drawn at 700. */
  currentMealId?: string;
  unit: GlucoseUnit;
  timeZone: string;
  /** For "I dag" / "I går". */
  now: Date;
  onOpen: (mealId: string) => void;
  caption?: string;
}

type Row = MealStatsRow & { id: string };

/**
 * Dato · Kulhydrat · Bolus før · Top · I mål af 3 t (Maaltid-Desktop). The date cell always
 * carries the meal's clock time, so every peak in the row has a visible anchor; the bolus column
 * is minutes between two stored times, never an amount, and shows only when a meal in view has a
 * stored bolus time (issue #215).
 */
export function MealStatsTable({
  rows,
  currentMealId,
  unit,
  timeZone,
  now,
  onOpen,
  caption,
}: MealStatsTableProps) {
  const t = useTranslations("stats");
  const locale = resolveLocale(useLocale());
  const missing = t("missing");
  const dateOf = (row: Row) =>
    t("dateTime", {
      date: relativeDay(t, row.ts, now, timeZone, locale),
      time: formatClock(new Date(row.ts), timeZone),
    });
  const anyBolus = rows.some((row) => row.bolusLeadMinutes !== undefined);
  const bolusColumn: DataColumn<Row> = {
    key: "bolus",
    header: t("table.bolusBefore"),
    align: "end",
    render: (row) =>
      row.bolusLeadMinutes === undefined
        ? missing
        : row.bolusLeadMinutes >= 0
          ? t("lead.minutes", { minutes: row.bolusLeadMinutes })
          : t("lead.afterShort", { minutes: -row.bolusLeadMinutes }),
  };
  const columns: DataColumn<Row>[] = [
    { key: "date", header: t("table.date"), render: dateOf },
    {
      key: "carbs",
      header: t("table.carbs"),
      align: "end",
      render: (row) => t("grams", { grams: Math.round(row.totalCarbs) }),
    },
    ...(anyBolus ? [bolusColumn] : []),
    {
      key: "peak",
      header: t("table.peak"),
      align: "end",
      render: (row) =>
        row.stats.peak ? (
          <PeakValue
            peak={{ mmol: row.stats.peak.mmol, ts: row.stats.peak.ts, mealTs: row.ts }}
            unit={unit}
            timeZone={timeZone}
            layout="value"
          />
        ) : (
          missing
        ),
    },
    {
      key: "inRange",
      header: t("table.inRange3h"),
      align: "end",
      render: (row) =>
        row.stats.inRange.coveredMinutes === 0
          ? missing
          : formatDuration(t, row.stats.inRange.minutes, "table"),
    },
  ];
  return (
    <DataTable<Row>
      rows={rows.map((row) => ({ ...row, id: row.mealId }))}
      columns={columns}
      rowLabel={dateOf}
      selectable={false}
      {...(currentMealId === undefined ? {} : { currentId: currentMealId })}
      {...(caption === undefined ? {} : { caption })}
      onActivate={(row) => {
        onOpen(row.mealId);
      }}
    />
  );
}

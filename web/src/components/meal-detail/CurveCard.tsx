"use client";

import type { GlucoseUnit, Reading } from "@frejsi/shared/schemas/glucose";
import type { MealCurveView } from "@frejsi/shared/schemas/history";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { ChartCaption, ChartLegend, GlucoseChart } from "@/components/glucose";
import { ChipGroup } from "@/components/ui";

import { hasNoReadings } from "./live";
import styles from "./meal-detail.module.css";

/** Previous occurrences drawn behind: three on the phone, five on desktop (plan §1). */
export const PREVIOUS_SHOWN = { phone: 3, desktop: 5 } as const;

const ONLY = "only";
const TOGETHER = "together";

export interface CurveCardProps {
  view: MealCurveView;
  /** The window's readings with the live ones merged in, each with its `ts`. */
  readings: readonly Reading[];
  now: Date;
  unit: GlucoseUnit;
  timeZone: string;
  size: "phone" | "desktop";
}

/**
 * "Hvad skete der bagefter": the meal curve from −1 h to +4 h with the meal line and the bolus
 * time, the same dish's earlier curves faintly behind, and the age of the newest reading while
 * the window is open. The phone has the legend; desktop has the two chips that switch the earlier
 * curves (Maaltid-Desktop), shown only when there are any.
 */
export function CurveCard({ view, readings, now, unit, timeZone, size }: CurveCardProps) {
  const t = useTranslations("mealDetail");
  const [mode, setMode] = useState<string>(TOGETHER);
  const previous = view.previous.slice(0, PREVIOUS_SHOWN[size]);
  const drawn = size === "desktop" && mode === ONLY ? [] : previous;
  const empty = hasNoReadings(view, readings, now);
  return (
    <section className={styles.curveCard} data-size={size} data-testid="curve-card">
      <div className={styles.curveHead}>
        <h2 className={styles.curveTitle}>{t("afterwards")}</h2>
        {size === "phone" && previous.length > 0 && (
          <span className={styles.curveSubtitle}>
            {t("previousBehind", { count: previous.length })}
          </span>
        )}
        {size === "desktop" && previous.length > 0 && (
          <div className={styles.compareChips}>
            <ChipGroup
              label={t("compare.label")}
              value={mode}
              onChange={setMode}
              options={[
                { value: ONLY, label: t("compare.onlyThis") },
                { value: TOGETHER, label: t("compare.withPrevious", { count: previous.length }) },
              ]}
            />
          </div>
        )}
      </div>
      <GlucoseChart
        variant="meal"
        readings={readings}
        mealTs={view.meal.ts}
        {...(view.meal.bolusTs !== undefined ? { bolusTs: view.meal.bolusTs } : {})}
        previous={drawn.map((p) => ({ mealTs: p.ts, readings: p.readings }))}
        target={view.target}
        unit={unit}
        timeZone={timeZone}
        now={now}
        size={size}
      />
      {empty && <p className={styles.empty}>{t("noReadings")}</p>}
      {size === "phone" && (
        <ChartLegend
          variant="meal"
          {...(view.meal.bolusTs !== undefined ? { bolusTs: view.meal.bolusTs } : {})}
          previous={drawn.length > 0}
          timeZone={timeZone}
        />
      )}
      <ChartCaption
        readings={readings}
        from={new Date(view.window.from)}
        to={new Date(view.window.to)}
      />
    </section>
  );
}

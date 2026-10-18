"use client";

import type { GlucoseUnit, Reading } from "@frejsi/shared/schemas/glucose";
import type { MealCurveView } from "@frejsi/shared/schemas/history";
import type { Role } from "@frejsi/shared/schemas/index";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

import {
  ChartCaption,
  ChartLegend,
  GlucoseChart,
  mealChartMarkers,
  readingsAround,
  useAgeText,
} from "@/components/glucose";
import { SymptomDetailCard } from "@/components/history/SymptomDetailCard";
import { usePumpHistory } from "@/components/pump/usePumpHistory";
import { useSymptomRange } from "@/components/history/useSymptomRange";
import { useKindLabel } from "@/components/symptoms/kinds";
import { ChipGroup } from "@/components/ui";
import { resolveLocale } from "@/lib/i18n/routing";
import type { FeedEventType } from "@/lib/live/live-feed";

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
  together?: boolean;
  onTogetherChange?: (together: boolean) => void;
  /**
   * The space and the screen's feed: with both, the window's symptoms are drawn on the axis and
   * read again on every `symptom.*` event (v0.6.0 plan §5). Without a space nothing is read.
   */
  spaceId?: string;
  subscribe?: (type: FeedEventType, handler: () => void) => () => void;
  /**
   * The meal page mounts the curve for owners and carers outside simpleMode only (a viewer is
   * redirected, simpleMode gets the calm view), so the defaults name that member. With a space,
   * the window's pump record is read for them (v0.7.0 plan §9) and never for anyone else.
   */
  role?: Role;
  simpleMode?: boolean;
}

/**
 * "Hvad skete der bagefter": the meal curve from −1 h to +4 h with the meal line and the bolus
 * time, the same dish's earlier curves faintly behind, and the age of the newest reading while
 * the window is open. The phone has the legend; desktop has the two chips that switch the earlier
 * curves (Maaltid-Desktop), shown only when there are any. The window's symptoms are diamonds on
 * the axis; a tap opens the detail with the readings around it (v0.6.0 plan §5).
 */
export function CurveCard({
  view,
  readings,
  now,
  unit,
  timeZone,
  size,
  together = true,
  onTogetherChange,
  spaceId,
  subscribe,
  role = "owner",
  simpleMode = false,
}: CurveCardProps) {
  const t = useTranslations("mealDetail");
  const glucose = useTranslations("glucose");
  const ageText = useAgeText();
  const locale = resolveLocale(useLocale());
  const symptomRange = useSymptomRange(
    spaceId ?? "",
    view.window.from,
    view.window.to,
    subscribe,
    spaceId !== undefined,
  );
  const symptoms = symptomRange.status === "ready" ? symptomRange.symptoms : [];
  // The window's pump record: the meal's own bolus with its units, and the automatic boluses in
  // the window as hollow markers (v0.7.0 plan §9). Read for a meal the pump record has reached
  // (it carries its bolus link), so a space without a pump never asks on every meal it opens.
  const pumpHistory = usePumpHistory(spaceId ?? "", view.window.from, view.window.to, {
    subscribe,
    role,
    simpleMode,
    enabled: spaceId !== undefined && view.meal.pumpBolusId !== undefined,
  });
  const pump =
    pumpHistory.status === "ready"
      ? { boluses: pumpHistory.boluses, reach: pumpHistory.reach }
      : undefined;
  const kindLabel = useKindLabel(locale, symptomRange.kinds);
  const [activeSymptomId, setActiveSymptomId] = useState<string | null>(null);
  const activeSymptom = symptoms.find((symptom) => symptom.id === activeSymptomId) ?? null;
  const mode = together ? TOGETHER : ONLY;
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
              onChange={(value) => onTogetherChange?.(value === TOGETHER)}
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
        {...(view.meal.symbol !== undefined ? { symbol: view.meal.symbol } : {})}
        pumpBolusId={view.meal.pumpBolusId}
        bolusUnits={view.meal.bolusUnits}
        pump={pump}
        symptoms={symptoms.map((symptom) => ({
          id: symptom.id,
          ts: symptom.ts,
          kind: symptom.kind,
          label: kindLabel(symptom.kind),
        }))}
        onSymptomTap={setActiveSymptomId}
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
          {...mealChartMarkers({
            mealTs: view.meal.ts,
            pump,
            pumpBolusId: view.meal.pumpBolusId,
          })}
        />
      )}
      <ChartCaption
        readings={readings}
        from={new Date(view.window.from)}
        to={new Date(view.window.to)}
      />
      {activeSymptom && (
        <SymptomDetailCard
          locale={locale}
          timeZone={timeZone}
          symptom={activeSymptom}
          spaceKinds={symptomRange.kinds}
          readings={readingsAround(
            activeSymptom.ts,
            readings,
            unit,
            locale,
            glucose(`unit.${unit}`),
            (ts) => ageText(ts, now),
          )}
          onClose={() => {
            setActiveSymptomId(null);
          }}
        />
      )}
    </section>
  );
}

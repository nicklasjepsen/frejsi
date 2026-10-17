"use client";

import type { GlucoseUnit } from "@frejsi/shared";
import { useLocale, useTranslations } from "next-intl";

import { FoodSymbol } from "@/components/food/FoodSymbol";
import { resolveLocale } from "@/lib/i18n/routing";
import { formatClock } from "@/lib/i18n/time";

import { formatBound } from "./format";
import styles from "./glucose.module.css";

export type ChartLegendProps =
  | {
      /** Maaltid-Telefon: 12 px muted, "Måltid", "Bolus 11:58", "Tidligere gange". */
      variant: "meal";
      /** The stored bolus time; without one the triangle entry is left out. */
      bolusTs?: string;
      /** Whether previous curves are drawn behind. */
      previous: boolean;
      timeZone: string;
    }
  | {
      /** Nu-Desktop: 14 px, "Måltid", "Bolus givet", "Mål 4–10 mmol/L". */
      variant: "day";
      /** Whether a meal in view has a stored bolus time; without one the triangle entry is left out. */
      bolus: boolean;
      target: { low: number; high: number };
      unit: GlucoseUnit;
    };

/** The meal entry's swatch: the plate, in the meal colour (v0.6.0 plan §7). */
function Plate({ size }: { size: number }) {
  return (
    <span className={styles.swatchMealPlate} aria-hidden="true" data-swatch="meal-plate">
      <FoodSymbol symbol="mixed" size={size} strokeWidth={2.2} />
    </span>
  );
}

function Triangle({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" aria-hidden="true" data-swatch="triangle">
      <path className={styles.bolus} d="M5 1 L9 9 H1 Z" />
    </svg>
  );
}

/**
 * The two drawn chart legends (plan §7), composed from one message key per entry so the dosing
 * test sees each whole string. "Bolus 11:58" is the `log.bolus.at` key; the triangle is a time.
 * The meal entry draws the plate, the symbol of a mixed dish (v0.6.0 plan §7).
 */
export function ChartLegend(props: ChartLegendProps) {
  const t = useTranslations("chart");
  const log = useTranslations("log");
  const g = useTranslations("glucose");
  const locale = resolveLocale(useLocale());
  if (props.variant === "meal") {
    return (
      <ul className={styles.legend} data-variant="meal">
        <li>
          <Plate size={10} />
          {t("legend.meal")}
        </li>
        {props.bolusTs !== undefined && (
          <li>
            <Triangle size={9} />
            {log("bolus.at", { time: formatClock(new Date(props.bolusTs), props.timeZone) })}
          </li>
        )}
        {props.previous && (
          <li>
            <span
              className={styles.swatchPreviousBar}
              aria-hidden="true"
              data-swatch="previous-bar"
            />
            {t("legend.previous")}
          </li>
        )}
      </ul>
    );
  }
  return (
    <ul className={styles.legend} data-variant="day">
      <li>
        <Plate size={12} />
        {t("legend.meal")}
      </li>
      {props.bolus && (
        <li>
          <Triangle size={10} />
          {t("legend.bolusGiven")}
        </li>
      )}
      <li>
        {g("targetWithUnit", {
          low: formatBound(props.target.low, props.unit, locale),
          high: formatBound(props.target.high, props.unit, locale),
          unit: g(`unit.${props.unit}`),
        })}
      </li>
    </ul>
  );
}

"use client";

import type { GlucoseUnit, Reading } from "@frejsi/shared";
import { useLocale, useTranslations } from "next-intl";

import { resolveLocale } from "@/lib/i18n/routing";

import { ageOf, capitalize, formatGlucose, isStale } from "./format";
import styles from "./glucose.module.css";
import { TrendArrow } from "./TrendArrow";

export type GlucoseValueSize = "phone" | "simple" | "desktop" | "inline" | "preview";

export interface GlucoseValueProps {
  /**
   * The reading, with its `ts`, or null before the first one. There is no prop for a bare number:
   * a value never renders without its age (CLAUDE.md hard rule).
   */
  reading: Reading | null;
  unit: GlucoseUnit;
  /** The clock the age is computed from; `useNow()` re-reads it every 30 s. */
  now: Date;
  size: GlucoseValueSize;
  /** `line`: "mmol/L · for 3 min. siden · stiger langsomt"; `split`: the trend word on its own line (Nu-Desktop). */
  layout?: "line" | "split";
  /** simpleMode leaves the unit out: "for 3 min. siden · stiger langsomt" (Nu-Simpel). */
  showUnit?: boolean;
}

const ARROW_SIZE: Record<GlucoseValueSize, number> = {
  phone: 40,
  simple: 64,
  desktop: 40,
  inline: 18,
  preview: 30,
};

/**
 * The glucose number with its trend arrow and age line (design README `GlucoseValue`). The number
 * is always the text colour, never coloured by its value. Before the first reading:
 * "Ingen målinger endnu". The age is part of the same element, so no layout can show the number
 * and hide the age.
 */
export function GlucoseValue({
  reading,
  unit,
  now,
  size,
  layout = "line",
  showUnit = true,
}: GlucoseValueProps) {
  const t = useTranslations("glucose");
  const locale = resolveLocale(useLocale());

  if (!reading) {
    return (
      <div className={styles.value} data-size={size} data-empty="true">
        <p className={styles.empty}>{t("noReadings")}</p>
      </div>
    );
  }

  const age = ageOf(reading.ts, now);
  const ageText =
    age.kind === "justNow"
      ? t("age.justNow")
      : age.kind === "minutes"
        ? t("age.minutes", { minutes: age.minutes })
        : age.kind === "hours"
          ? age.minutes === 0
            ? t("age.wholeHours", { hours: age.hours })
            : t("age.hours", { hours: age.hours, minutes: age.minutes })
          : t("age.overADay");
  const trendWord = t(`trend.${reading.trend}`);
  const unitText = t(`unit.${unit}`);
  const line = [showUnit ? unitText : null, ageText, layout === "line" ? trendWord : null]
    .filter((part): part is string => part !== null)
    .join(" · ");

  return (
    <div
      className={styles.value}
      data-size={size}
      data-stale={isStale(reading, now) ? "true" : undefined}
    >
      <div className={styles.hero}>
        <span className={`${styles.number} tabular`} data-testid="glucose-number">
          {formatGlucose(reading.mmol, unit, locale)}
        </span>
        <TrendArrow trend={reading.trend} size={ARROW_SIZE[size]} circled={size === "simple"} />
      </div>
      <p className={styles.meta} data-testid="glucose-age">
        {line}
      </p>
      {layout === "split" && <p className={styles.meta}>{capitalize(trendWord, locale)}</p>}
    </div>
  );
}

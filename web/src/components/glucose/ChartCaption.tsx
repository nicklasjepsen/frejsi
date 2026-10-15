"use client";

import type { Reading } from "@frejsi/shared";
import { useTranslations } from "next-intl";

import styles from "./glucose.module.css";
import { useAgeText } from "./useAgeText";
import { useNow } from "./useNow";

export interface ChartCaptionProps {
  /** The curve's readings, each with its `ts`; the newest one's age is shown. */
  readings: readonly Reading[];
  /** The curve's window. */
  from: Date;
  to: Date;
}

/**
 * "sidste måling for 3 min. siden" under a curve whose window includes now (plan §7, decision
 * 17), so the live end of a curve is never a value without its age. Re-reads the clock every
 * 30 s like the age line; renders nothing once the window is over or before the first reading.
 */
export function ChartCaption({ readings, from, to }: ChartCaptionProps) {
  const t = useTranslations("chart");
  const ageText = useAgeText();
  const now = useNow();
  const nowMs = now.getTime();
  if (nowMs < from.getTime() || nowMs > to.getTime()) return null;
  const newest = readings.reduce<Reading | null>(
    (best, r) => (best === null || r.ts > best.ts ? r : best),
    null,
  );
  if (!newest) return null;
  return (
    <p className={styles.caption} data-testid="chart-caption">
      {t("lastReading", { age: ageText(newest.ts, now) })}
    </p>
  );
}

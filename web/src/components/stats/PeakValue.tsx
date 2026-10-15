"use client";

import type { GlucoseUnit } from "@frejsi/shared";
import { useLocale, useTranslations } from "next-intl";

import { formatGlucose } from "@/components/glucose/format";
import { resolveLocale } from "@/lib/i18n/routing";
import { formatClock } from "@/lib/i18n/time";

import { formatDuration } from "./format";
import { StatTile } from "./StatTile";
import styles from "./stats.module.css";

export interface PeakValueProps {
  /**
   * The peak with its own time and the meal's. There is no bare-number form: a glucose value is
   * never rendered without its anchor in time (CLAUDE.md hard rule).
   */
  peak: { mmol: number; ts: string; mealTs: string };
  unit: GlucoseUnit;
  timeZone: string;
  /** `tile`: a StatTile "Top" with "efter 1 t 05 min"; `value`: the number alone (tables). */
  layout?: "tile" | "value";
  /** `short`: the desktop footnote "efter 1 t 05". */
  duration?: "long" | "short";
}

/**
 * The meal's peak: "9,6" with "efter 1 t 05 min", the peak's clock time in the space's timezone
 * as its title and accessible name ("Top 9,6 kl. 13:15").
 */
export function PeakValue({
  peak,
  unit,
  timeZone,
  layout = "tile",
  duration = "long",
}: PeakValueProps) {
  const t = useTranslations("stats");
  const locale = resolveLocale(useLocale());
  const value = formatGlucose(peak.mmol, unit, locale);
  const name = t("peakAt", { value, time: formatClock(new Date(peak.ts), timeZone) });
  const number = (
    <span className={styles.peak} title={name} aria-label={name} role="img">
      {value}
    </span>
  );
  if (layout === "value") return number;
  const minutes = (new Date(peak.ts).getTime() - new Date(peak.mealTs).getTime()) / 60_000;
  return (
    <StatTile
      label={t("peak")}
      value={number}
      footnote={t("after", { duration: formatDuration(t, minutes, duration) })}
    />
  );
}

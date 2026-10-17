"use client";

import type { GlucoseUnit } from "@frejsi/shared/schemas/glucose";
import type { MealStats, Target } from "@frejsi/shared/schemas/history";
import { useLocale, useTranslations } from "next-intl";

import { formatBound } from "@/components/glucose/format";
import { PeakValue, StatGrid, StatTile } from "@/components/stats";
import { resolveLocale } from "@/lib/i18n/routing";

import { tileDuration } from "./format";
import styles from "./meal-detail.module.css";

export interface MealTilesProps {
  stats: MealStats;
  mealTs: string;
  target: Target;
  unit: GlucoseUnit;
  timeZone: string;
  size: "phone" | "desktop";
}

/**
 * The three tiles (plan §5): the peak with its time ("Top · 9,6 · efter 1 t 05 min"), time in
 * range over the three hours ("I mål 4–10 · 3 t · af 3 t", "indtil nu" while the window is open)
 * and the gap between the stored bolus time and the meal as a number with a position word. Desktop uses
 * the short footnotes ("efter 1 t 05", "før"). Nothing here is an amount.
 */
export function MealTiles({ stats, mealTs, target, unit, timeZone, size }: MealTilesProps) {
  const s = useTranslations("stats");
  const t = useTranslations("mealDetail");
  const locale = resolveLocale(useLocale());
  const style = size === "desktop" ? "short" : "long";
  const inRange = stats.inRange;
  const of = { duration: tileDuration(s, inRange.windowMinutes, style) };
  const lead = stats.bolusLeadMinutes;
  const leadWord =
    lead === undefined || lead === 0
      ? undefined
      : size === "desktop"
        ? t(lead > 0 ? "leadShort.before" : "leadShort.after")
        : s(lead > 0 ? "lead.before" : "lead.after");
  return (
    <div className={styles.tiles} role="group" aria-label={t("tiles")} data-testid="meal-tiles">
      <StatGrid columns={3}>
        {stats.peak ? (
          <PeakValue
            peak={{ mmol: stats.peak.mmol, ts: stats.peak.ts, mealTs }}
            unit={unit}
            timeZone={timeZone}
            duration={style}
          />
        ) : (
          <StatTile label={s("peak")} value={s("missing")} />
        )}
        <StatTile
          label={s("inRange", {
            low: formatBound(target.low, unit, locale),
            high: formatBound(target.high, unit, locale),
          })}
          value={tileDuration(s, inRange.minutes, style)}
          footnote={inRange.complete ? s("of", of) : s("ofUntilNow", of)}
        />
        {lead === undefined ? (
          <StatTile label={s("bolus")} value={s("missing")} footnote={s("lead.none")} />
        ) : (
          <StatTile
            label={s("bolus")}
            value={s("lead.minutes", { minutes: Math.abs(lead) })}
            {...(leadWord !== undefined ? { footnote: leadWord } : {})}
          />
        )}
      </StatGrid>
    </div>
  );
}

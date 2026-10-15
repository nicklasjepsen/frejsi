"use client";

import type { GlucoseUnit, Reading } from "@frejsi/shared";
import { useLocale } from "next-intl";

import { resolveLocale } from "@/lib/i18n/routing";

import { chartGeometry, type ChartVariant } from "./chart";
import styles from "./glucose.module.css";

export interface GlucoseChartProps {
  readings: Reading[];
  from: Date;
  to: Date;
  /** In mmol; the labels are drawn in `unit`. */
  targetLow: number;
  targetHigh: number;
  unit: GlucoseUnit;
  timeZone: string;
  variant: ChartVariant;
  /** The accessible name: "Glukose de seneste 3 timer". */
  label: string;
}

/**
 * The curve of the artboards (tokens.json#chart): the target band at the accent's band colour,
 * dashed gridlines at both bounds with the labels right of the plot, the line in the text colour
 * with a dot at the end, and the time axis with "now" in bold. Gaps in the readings are gaps in
 * the line. Meal lines and bolus triangles arrive with v0.2.0/v0.3.0.
 */
export function GlucoseChart({
  readings,
  from,
  to,
  targetLow,
  targetHigh,
  unit,
  timeZone,
  variant,
  label,
}: GlucoseChartProps) {
  const locale = resolveLocale(useLocale());
  const g = chartGeometry({
    readings,
    from,
    to,
    targetLow,
    targetHigh,
    unit,
    timeZone,
    locale,
    variant,
  });
  return (
    <svg
      className={styles.chart}
      viewBox={`0 0 ${g.width} ${g.height}`}
      width="100%"
      role="img"
      aria-label={label}
      data-variant={variant}
    >
      <rect
        className={styles.band}
        x="0"
        y={g.band.top}
        width={g.plotWidth}
        height={Math.max(0, g.band.bottom - g.band.top)}
        data-testid="target-band"
      />
      <line className={styles.bound} x1="0" y1={g.band.top} x2={g.plotWidth} y2={g.band.top} />
      <line
        className={styles.bound}
        x1="0"
        y1={g.band.bottom}
        x2={g.plotWidth}
        y2={g.band.bottom}
      />
      <text
        className={styles.chartLabel}
        x={g.band.labelX}
        y={g.band.top + 4}
        fontSize={g.labelSize}
      >
        {g.band.highLabel}
      </text>
      <text
        className={styles.chartLabel}
        x={g.band.labelX}
        y={g.band.bottom + 4}
        fontSize={g.labelSize}
      >
        {g.band.lowLabel}
      </text>
      {g.segments.map((points, index) =>
        points.includes(" ") ? (
          <polyline key={index} className={styles.line} points={points} data-testid="curve" />
        ) : (
          <circle
            key={index}
            className={styles.endDot}
            cx={Number(points.split(",")[0])}
            cy={Number(points.split(",")[1])}
            r="2.5"
            data-testid="lone-point"
          />
        ),
      )}
      {g.end && <circle className={styles.endDot} cx={g.end.x} cy={g.end.y} r="5" />}
      {g.ticks.map((tick) => (
        <text
          key={`${tick.x}-${tick.label}`}
          className={tick.strong ? styles.tickStrong : styles.chartLabel}
          x={tick.x}
          y={g.axisY}
          fontSize={g.labelSize}
          textAnchor={tick.anchor}
        >
          {tick.label}
        </text>
      ))}
    </svg>
  );
}

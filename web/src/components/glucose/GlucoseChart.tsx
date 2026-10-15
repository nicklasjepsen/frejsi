"use client";

import type { GlucoseUnit, Reading } from "@frejsi/shared";
import { useLocale, useTranslations } from "next-intl";

import { resolveLocale, type AppLocale } from "@/lib/i18n/routing";
import { formatClock } from "@/lib/i18n/time";

import {
  chartGeometry,
  mealChartGeometry,
  weekTileGeometry,
  type ChartGeometry,
  type ChartMeal,
  type MealChartSize,
  type PreviousCurve,
} from "./chart";
import { capitalize } from "./format";
import styles from "./glucose.module.css";

interface CurveBase {
  readings: Reading[];
  from: Date;
  to: Date;
  /** In mmol; the labels are drawn in `unit`. */
  targetLow: number;
  targetHigh: number;
  unit: GlucoseUnit;
  timeZone: string;
}

export interface SparklineChartProps extends CurveBase {
  variant: "sparkline";
  /** The accessible name: "Glukose de seneste 3 timer". */
  label: string;
}

export interface DayChartProps extends CurveBase {
  variant: "day";
  /** `phone` draws the day in the curvePhone viewBox (Historik-Telefon); default `desktop`. */
  size?: "phone" | "desktop";
  /** Meal lines at `ts` and bolus triangles at `bolusTs` (plan §7). */
  meals?: readonly ChartMeal[];
  /** When given, each meal line is a 44 px-wide button that calls it with the meal's id. */
  onMealTap?: (mealId: string) => void;
  /**
   * The accessible name. Without one, the §7 day label: "Glukose i dag fra {from} til {to} med
   * {n} måltider" (Nu-Desktop), or with `labelKind="history"` "Glukose i dag med måltider markeret".
   */
  label?: string;
  labelKind?: "now" | "history";
}

export interface MealChartProps {
  variant: "meal";
  /** The readings around the meal, each with its `ts`; those after `now` are not drawn. */
  readings: readonly Reading[];
  mealTs: string;
  /** The time of the bolus tap: a time marker only, never an amount. */
  bolusTs?: string;
  /** The same dish's earlier occurrences, drawn faintly behind, each relative to its own meal. */
  previous: readonly PreviousCurve[];
  target: { low: number; high: number };
  unit: GlucoseUnit;
  timeZone: string;
  now: Date;
  size: MealChartSize;
}

export interface WeekTileChartProps {
  variant: "week-tile";
  /** The day downsampled to 30-minute buckets, at most 48 points. */
  curve: readonly { ts: string; mmol: number }[];
  mealTimes: readonly string[];
  /** The local day, 00:00 to 24:00; its weekday is the accessible name ("Mandag"). */
  from: Date;
  to: Date;
  target: { low: number; high: number };
  timeZone: string;
}

export type GlucoseChartProps =
  SparklineChartProps | DayChartProps | MealChartProps | WeekTileChartProps;

const NUMBER_LOCALE: Record<AppLocale, string> = { da: "da-DK", en: "en-GB" };

/**
 * The curves of the artboards (tokens.json#chart), hand-written SVG (v0.3.0 plan §7): the target
 * band at the accent's band colour, dashed gridlines at both bounds with the labels right of the
 * plot, the line in the text colour with a dot at the end, meal lines in `meal.marker`, bolus
 * triangles in `meal.bolusMarker` (a time, never an amount) and the time axis. Gaps in the readings
 * are gaps in the line.
 */
export function GlucoseChart(props: GlucoseChartProps) {
  switch (props.variant) {
    case "meal":
      return <MealChart {...props} />;
    case "week-tile":
      return <WeekTile {...props} />;
    default:
      return <CurveChart {...props} />;
  }
}

function Band({ g }: { g: Pick<ChartGeometry, "band" | "plotWidth" | "labelSize"> }) {
  return (
    <>
      <rect
        className={styles.band}
        x="0"
        y={g.band.top}
        width={g.plotWidth}
        height={Math.max(0, g.band.bottom - g.band.top)}
        data-testid="target-band"
      />
      {[g.band.top, g.band.bottom].map((y, index) => (
        <line
          key={index}
          className={styles.bound}
          x1="0"
          y1={y}
          x2={g.plotWidth}
          y2={y}
          data-testid="bound"
        />
      ))}
      {[
        [g.band.top, g.band.highLabel],
        [g.band.bottom, g.band.lowLabel],
      ].map(([y, label], index) => (
        <text
          key={index}
          className={styles.chartLabel}
          x={g.band.labelX}
          y={Number(y) + 4}
          fontSize={g.labelSize}
          data-testid="bound-label"
        >
          {label}
        </text>
      ))}
    </>
  );
}

function Segments({ segments }: { segments: readonly string[] }) {
  return segments.map((points, index) =>
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
  );
}

function CurveChart(props: SparklineChartProps | DayChartProps) {
  const locale = resolveLocale(useLocale());
  const t = useTranslations("chart");
  const log = useTranslations("log");
  const day = props.variant === "day" ? props : null;
  const g = chartGeometry({
    readings: props.readings,
    from: props.from,
    to: props.to,
    targetLow: props.targetLow,
    targetHigh: props.targetHigh,
    unit: props.unit,
    timeZone: props.timeZone,
    locale,
    variant: props.variant,
    size: day?.size,
    meals: day?.meals,
  });
  const label =
    props.label ??
    (day?.labelKind === "history"
      ? t("aria.historyDay")
      : t("aria.dayWithMeals", {
          from: formatClock(props.from, props.timeZone),
          to: formatClock(props.to, props.timeZone),
          count: g.meals.length,
        }));
  const svg = (
    <svg
      className={styles.chart}
      viewBox={`0 0 ${g.width} ${g.height}`}
      width="100%"
      role="img"
      aria-label={label}
      data-variant={props.variant}
    >
      <Band g={g} />
      {g.meals.map((meal) => (
        <line
          key={meal.mealId}
          className={styles.mealLine}
          x1={meal.x}
          y1={g.markerTop}
          x2={meal.x}
          y2={g.plotHeight}
          data-testid="meal-line"
        />
      ))}
      {g.boluses.map((bolus) => (
        <path
          key={bolus.mealId}
          className={styles.bolus}
          d={bolus.path}
          role="img"
          aria-label={log("bolus.at", { time: bolus.clock })}
          data-testid="bolus"
        />
      ))}
      <Segments segments={g.segments} />
      {g.end && (
        <circle className={styles.endDot} cx={g.end.x} cy={g.end.y} r="5" data-testid="end-dot" />
      )}
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
  if (!day?.onMealTap || g.meals.length === 0) return svg;
  const onMealTap = day.onMealTap;
  return (
    <div className={styles.tapLayer}>
      {svg}
      {g.meals.map((meal) => (
        <button
          key={meal.mealId}
          type="button"
          className={styles.mealTap}
          style={{
            left: `${(meal.x / g.width) * 100}%`,
            width: "44px",
            height: `${(g.plotHeight / g.height) * 100}%`,
          }}
          aria-label={t("mealAt", { time: formatClock(new Date(meal.ts), props.timeZone) })}
          onClick={() => {
            onMealTap(meal.mealId);
          }}
        />
      ))}
    </div>
  );
}

function MealChart(props: MealChartProps) {
  const locale = resolveLocale(useLocale());
  const t = useTranslations("chart");
  const log = useTranslations("log");
  const g = mealChartGeometry({ ...props, locale });
  // The desktop label names the previous curves (Maaltid-Desktop); the phone one does not.
  const label =
    props.size === "desktop" && props.previous.length > 0
      ? t("aria.mealWithPrevious", { count: props.previous.length })
      : t("aria.meal");
  return (
    <svg
      className={styles.chart}
      viewBox={`0 0 ${g.width} ${g.height}`}
      width="100%"
      role="img"
      aria-label={label}
      data-variant="meal"
      data-size={props.size}
    >
      <Band g={g} />
      {g.previous.flatMap((segments, i) =>
        segments.map((points, j) => (
          <polyline
            key={`${i}-${j}`}
            className={styles.previousLine}
            points={points}
            opacity={g.previousOpacity}
            data-testid="previous"
          />
        )),
      )}
      <line
        className={styles.mealLine}
        x1={g.meal.x}
        y1={g.meal.top}
        x2={g.meal.x}
        y2={g.meal.bottom}
        data-testid="meal-line"
      />
      {g.bolus && (
        <path
          className={styles.bolus}
          d={g.bolus.path}
          role="img"
          aria-label={log("bolus.at", { time: g.bolus.clock })}
          data-testid="bolus"
        />
      )}
      <Segments segments={g.segments} />
      {g.end && (
        <circle className={styles.endDot} cx={g.end.x} cy={g.end.y} r="5" data-testid="end-dot" />
      )}
      {g.ticks.map((tick) => (
        <text
          key={tick.hours}
          className={tick.hours === 0 ? styles.tickMeal : styles.chartLabel}
          x={tick.x}
          y={g.axisY}
          fontSize={g.labelSize}
          fontWeight={tick.hours === 0 ? 700 : undefined}
          textAnchor={tick.anchor}
          data-testid="tick"
          data-tick={tick.hours === 0 ? "meal" : undefined}
        >
          {tick.hours === 0
            ? g.mealClock
            : tick.hours < 0
              ? t("axis.hoursBefore", { hours: -tick.hours })
              : t("axis.hoursAfter", { hours: tick.hours })}
        </text>
      ))}
    </svg>
  );
}

function WeekTile(props: WeekTileChartProps) {
  const locale = resolveLocale(useLocale());
  const g = weekTileGeometry(props);
  const weekday = capitalize(
    new Intl.DateTimeFormat(NUMBER_LOCALE[locale], {
      weekday: "long",
      timeZone: props.timeZone,
    }).format(props.from),
    locale,
  );
  return (
    <svg
      className={styles.chart}
      viewBox={`0 0 ${g.width} ${g.height}`}
      width="100%"
      role="img"
      aria-label={weekday}
      data-variant="week-tile"
    >
      <rect
        className={styles.band}
        x="0"
        y={g.band.top}
        width={g.width}
        height={Math.max(0, g.band.bottom - g.band.top)}
        data-testid="target-band"
      />
      {g.segments.map((points, index) =>
        points.includes(" ") ? (
          <polyline key={index} className={styles.weekLine} points={points} />
        ) : (
          <circle
            key={index}
            className={styles.endDot}
            cx={Number(points.split(",")[0])}
            cy={Number(points.split(",")[1])}
            r="1.8"
            data-testid="lone-point"
          />
        ),
      )}
      {g.mealDots.map((dot, index) => (
        <circle
          key={index}
          className={styles.mealDot}
          cx={dot.x}
          cy={dot.y}
          r="2.5"
          data-testid="meal-dot"
        />
      ))}
    </svg>
  );
}

"use client";

import type { GlucoseUnit, Reading } from "@frejsi/shared";
import { formatUnits } from "@frejsi/shared/pump/units";
import type { MealSymbol } from "@frejsi/shared/schemas/food";
import type { PumpBolusKind } from "@frejsi/shared/schemas/pump";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { FoodSymbol } from "@/components/food/FoodSymbol";
import { resolveLocale, type AppLocale } from "@/lib/i18n/routing";
import { formatClock } from "@/lib/i18n/time";

import {
  chartGeometry,
  mealChartGeometry,
  weekTileGeometry,
  type ChartGeometry,
  type ChartMeal,
  type ChartPump,
  type ChartPumpMark,
  type ChartPumpReach,
  type ChartSymptom,
  type ChartSymptomMark,
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
  /**
   * The pump record (v0.7.0 plan §9): each bolus at its time with its units, and the reach tick.
   * Owners and carers outside simpleMode only; the screens never pass it otherwise.
   */
  pump?: ChartPump;
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
  /** Symptom diamonds on the time axis (v0.6.0 plan §5), each a 44 px tap target when tappable. */
  symptoms?: readonly ChartSymptom[];
  onSymptomTap?: (symptomId: string) => void;
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
  /** The meal's bolus time: from the pump record (v0.7.0) or an old tap. */
  bolusTs?: string;
  /** The pump bolus `bolusTs` came from: its recorded units label the triangle (v0.7.0). */
  pumpBolusId?: string | undefined;
  /** The linked bolus's units from the meal view, while the pump list has not arrived. */
  bolusUnits?: number | undefined;
  /** The pump record: automatic and other boluses in the window are hollow markers. */
  pump?: ChartPump | undefined;
  /** The meal's food symbol, above the plot on the meal line (v0.6.0 plan §7). */
  symbol?: MealSymbol;
  /** Symptoms; those within the window are diamonds on the axis (plan §5). */
  symptoms?: readonly ChartSymptom[];
  onSymptomTap?: (symptomId: string) => void;
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
  /** The viewBox width: 120 (Historik-Desktop) unless the phone asks for a wider tile. */
  width?: number;
  /** The day downsampled to 30-minute buckets, at most 48 points. */
  curve: readonly { ts: string; mmol: number }[];
  mealTimes: readonly string[];
  /** The same meals with their symbols: drawn at 8 px in place of the dots when given. */
  meals?: readonly { ts: string; symbol: MealSymbol }[];
  symptoms?: readonly ChartSymptom[];
  onSymptomTap?: (symptomId: string) => void;
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
 * plot, the line in the text colour with a dot at the end, meal lines in `meal.marker` with the
 * meal's food symbol at the top (v0.6.0 plan §7), bolus triangles in `meal.bolusMarker` (a time,
 * never an amount) and the time axis. Gaps in the readings are gaps in the line.
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

/**
 * The bolus marks are nested in an atomic `role="img"`, so their times go into the chart's own name
 * ("… . Bolus 11:58"): a time only, never an amount.
 */
function withBoluses(label: string, boluses: readonly string[]): string {
  return boluses.length === 0 ? label : `${label}. ${boluses.join(". ")}`;
}

/** The symptom diamonds: on the axis, the text colour, never terracotta (decision 14). */
function SymptomMarks({ marks }: { marks: readonly ChartSymptomMark[] }) {
  return marks.map((mark) => (
    <path
      key={mark.id}
      className={styles.symptomMarker}
      d={mark.path}
      aria-hidden="true"
      data-testid="symptom-marker"
      data-kind={mark.kind}
    />
  ));
}

/**
 * The pump boluses (v0.7.0 plan §9): standard and extended in the meal's bolus colour, automatic
 * and other as the hollow marker in the text colour; the units above a manual triangle where the
 * curve has room. Hidden from the accessibility tree: each has its own named button above.
 */
function PumpMarks({ marks, labelSize }: { marks: readonly ChartPumpMark[]; labelSize: number }) {
  return marks.map((mark) => (
    <g key={mark.id} aria-hidden="true">
      <path
        className={mark.shape === "triangle" ? styles.bolus : styles.autoBolus}
        d={mark.path}
        aria-hidden="true"
        data-testid="pump-bolus"
        data-shape={mark.shape}
        data-kind={mark.kind}
      />
      {mark.label && (
        <text
          className={styles.pumpLabel}
          x={mark.x}
          y={mark.label.y}
          fontSize={labelSize}
          textAnchor="middle"
          data-testid="pump-label"
        >
          {mark.label.text}
        </text>
      )}
    </g>
  ));
}

/** The dotted reach tick and its caption, "Pumpe til 11:58": a time, never a reading. */
function PumpReach({
  reach,
  top,
  bottom,
  width,
  labelSize,
  caption,
}: {
  reach: ChartPumpReach | null;
  top: number;
  bottom: number;
  width: number;
  labelSize: number;
  caption: string;
}) {
  if (!reach) return null;
  // Left of the tick, where the record is; right of it when the tick is near the left edge.
  const before = reach.x > width * 0.3;
  return (
    <g aria-hidden="true">
      <line
        className={styles.pumpReach}
        x1={reach.x}
        y1={top}
        x2={reach.x}
        y2={bottom}
        data-testid="pump-reach"
      />
      <text
        className={styles.chartLabel}
        x={before ? reach.x - 4 : reach.x + 4}
        y={top + labelSize}
        fontSize={labelSize}
        textAnchor={before ? "end" : "start"}
        data-testid="pump-reach-caption"
      >
        {caption}
      </text>
    </g>
  );
}

/** A pump marker's name and popover text: "Bolus 11:58 · 2,4 E", "Automatisk bolus 03:10 · 0,6 E". */
function usePumpName(): (mark: { kind: PumpBolusKind; clock: string; units: number }) => string {
  const t = useTranslations("pump");
  const locale = resolveLocale(useLocale());
  return (mark) =>
    t(mark.kind === "automatic" ? "marker.automatic" : "marker.bolus", {
      time: mark.clock,
      units: formatUnits(mark.units, locale),
    });
}

/** The marker a pump tap target sits on: its x and the name it carries. */
interface PumpTarget {
  id: string;
  x: number;
  name: string;
}

/** The tap target's width in px; neighbours closer than this share the space between them. */
const TAP_WIDTH = 44;

/**
 * Each symptom target's left edge and width in px, so two symptoms logged close together each
 * keep their own target instead of the later one covering the earlier: a target reaches at most
 * halfway to its neighbour. Two at the same x coincide, and the later one is on top.
 */
export function symptomTargets(
  marks: readonly { x: number }[],
  width: number,
  pxPerUnit: number,
): { left: number; width: number }[] {
  const sorted = marks.map((mark, index) => ({ index, px: mark.x * pxPerUnit }));
  sorted.sort((a, b) => a.px - b.px);
  const out: { left: number; width: number }[] = new Array<{ left: number; width: number }>(
    marks.length,
  );
  sorted.forEach((mark, i) => {
    const previous = sorted[i - 1];
    const next = sorted[i + 1];
    const half = TAP_WIDTH / 2;
    const left = Math.max(mark.px - half, previous ? (previous.px + mark.px) / 2 : -Infinity, 0);
    const right = Math.min(
      mark.px + half,
      next ? (next.px + mark.px) / 2 : Infinity,
      width * pxPerUnit,
    );
    out[mark.index] = { left, width: Math.max(0, right - left) };
  });
  return out;
}

/**
 * The 44 px tap targets over the SVG: one per meal line (the plot's height) and one per symptom
 * diamond (44 px on the axis, narrower only where two symptoms sit closer than that), each named
 * with its time. Without any handler the SVG is returned as it is.
 */
function TapLayer({
  svg,
  width,
  meals,
  symptoms,
  pump = null,
  timeZone,
  mealHeight,
}: {
  svg: ReactNode;
  width: number;
  meals: { marks: ChartGeometry["meals"]; onTap: (mealId: string) => void } | null;
  symptoms: { marks: readonly ChartSymptomMark[]; onTap: (symptomId: string) => void } | null;
  /** The pump markers' targets and where the baseline is, as a share of the chart's height. */
  pump?: { targets: readonly PumpTarget[]; baseline: number } | null;
  timeZone: string;
  /** The meal target's height as a share of the chart's height. */
  mealHeight: string;
}) {
  const t = useTranslations("chart");
  const categories = useTranslations("foodCategory");
  const layer = useRef<HTMLDivElement>(null);
  const popoverId = useId();
  const [openPump, setOpenPump] = useState<string | null>(null);
  // A tap anywhere outside the pump targets closes the popover.
  useEffect(() => {
    if (openPump === null) return;
    const close = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element && target.closest("[data-pump-tap]"))) setOpenPump(null);
    };
    document.addEventListener("pointerdown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
    };
  }, [openPump]);
  // The rendered width, so neighbouring targets can share the pixels between them; before the
  // first layout (and on the server) the SVG's own units stand in for pixels.
  const [pxPerUnit, setPxPerUnit] = useState(1);
  useEffect(() => {
    const node = layer.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const rendered = node.getBoundingClientRect().width;
      if (rendered > 0) setPxPerUnit(rendered / width);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [width]);
  const pumpTargets = pump?.targets ?? [];
  if (
    (!meals || meals.marks.length === 0) &&
    (!symptoms || symptoms.marks.length === 0) &&
    pumpTargets.length === 0
  )
    return svg;
  const open = pumpTargets.find((target) => target.id === openPump) ?? null;
  const baseline = `${((pump?.baseline ?? 1) * 100).toFixed(2)}%`;
  // "Måltid, Brød, kl. 12:10" for a known symbol; "Måltid kl. 12:10" for unknown or none.
  const mealName = (symbol: MealSymbol | undefined, time: string) =>
    symbol !== undefined && symbol !== "unknown"
      ? t("mealWithCategory", { category: categories(`names.${symbol}`), time })
      : t("mealAt", { time });
  const left = (x: number) => `${(x / width) * 100}%`;
  const targets = symptomTargets(symptoms?.marks ?? [], width, pxPerUnit);
  // Pump markers close together share the space between them the same way, so a tap on one never
  // opens its neighbour.
  const pumpBoxes = symptomTargets(pumpTargets, width, pxPerUnit);
  return (
    <div className={styles.tapLayer} ref={layer}>
      {svg}
      {meals?.marks.map((meal) => (
        <button
          key={meal.mealId}
          type="button"
          className={styles.mealTap}
          style={{ left: left(meal.x), width: "44px", height: mealHeight }}
          aria-label={mealName(meal.symbol, formatClock(new Date(meal.ts), timeZone))}
          onClick={() => {
            meals.onTap(meal.mealId);
          }}
        />
      ))}
      {symptoms?.marks.map((mark, index) => (
        <button
          key={mark.id}
          type="button"
          className={styles.symptomTap}
          style={{
            left: `${targets[index]?.left ?? 0}px`,
            width: `${targets[index]?.width ?? TAP_WIDTH}px`,
            height: `${TAP_WIDTH}px`,
          }}
          aria-label={t("symptomAt", {
            kind: mark.label,
            time: formatClock(new Date(mark.ts), timeZone),
          })}
          data-testid="symptom-tap"
          onClick={() => {
            symptoms.onTap(mark.id);
          }}
        />
      ))}
      {pumpTargets.map((target, index) => (
        <button
          key={target.id}
          type="button"
          className={styles.pumpTap}
          style={{
            left: `${pumpBoxes[index]?.left ?? 0}px`,
            width: `${pumpBoxes[index]?.width ?? TAP_WIDTH}px`,
            top: `calc(${baseline} - 30px)`,
          }}
          aria-label={target.name}
          aria-expanded={openPump === target.id}
          aria-controls={openPump === target.id ? popoverId : undefined}
          data-testid="pump-tap"
          data-pump-tap=""
          onClick={() => {
            setOpenPump((current) => (current === target.id ? null : target.id));
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpenPump(null);
          }}
        />
      ))}
      {open && (
        <p
          id={popoverId}
          role="status"
          className={styles.pumpPopover}
          style={{ left: `${open.x * pxPerUnit}px`, top: `calc(${baseline} - 34px)` }}
          data-anchor={open.x < width * 0.2 ? "start" : open.x > width * 0.8 ? "end" : "middle"}
          data-testid="pump-popover"
        >
          {open.name}
        </p>
      )}
    </div>
  );
}

/** A food symbol nested in the chart's SVG, in the meal colour (`.mealSymbol`). */
function MealSymbolGlyph({
  symbol,
  x,
  y,
  size,
}: {
  symbol: MealSymbol;
  x: number;
  y: number;
  size: number;
}) {
  return (
    <g className={styles.mealSymbol}>
      <FoodSymbol symbol={symbol} size={size} x={x} y={y} strokeWidth={2.2} />
    </g>
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
    symptoms: day?.symptoms,
    pump: props.pump,
  });
  const pumpT = useTranslations("pump");
  const pumpName = usePumpName();
  const reachText = g.reach ? pumpT("reach", { time: g.reach.clock }) : null;
  const label =
    props.label ??
    (day?.labelKind === "history"
      ? t("aria.historyDay")
      : t("aria.dayWithMeals", {
          from: formatClock(props.from, props.timeZone),
          to: formatClock(props.to, props.timeZone),
          count: g.meals.length,
        }));
  const bolusText = g.boluses.map((bolus) => log("bolus.at", { time: bolus.clock }));
  const svg = (
    <svg
      className={styles.chart}
      viewBox={`0 0 ${g.width} ${g.height}`}
      width="100%"
      role="img"
      aria-label={withBoluses(label, reachText ? [...bolusText, reachText] : bolusText)}
      data-variant={props.variant}
    >
      <Band g={g} />
      {g.meals.map((meal) => (
        <line
          key={meal.mealId}
          className={styles.mealLine}
          x1={meal.x}
          y1={meal.lineTop}
          x2={meal.x}
          y2={g.plotHeight}
          data-testid="meal-line"
        />
      ))}
      {g.meals.map(
        (meal) =>
          meal.symbol !== undefined && (
            <MealSymbolGlyph
              key={`${meal.mealId}-symbol`}
              symbol={meal.symbol}
              x={meal.x - g.symbolSize / 2}
              y={g.markerTop - g.symbolSize / 2}
              size={g.symbolSize}
            />
          ),
      )}
      {g.boluses.map((bolus) => (
        <path
          key={bolus.mealId}
          className={styles.bolus}
          d={bolus.path}
          aria-hidden="true"
          data-testid="bolus"
        />
      ))}
      <PumpMarks marks={g.pumpMarks} labelSize={g.pumpLabelSize} />
      <PumpReach
        reach={g.reach}
        top={0}
        bottom={g.plotHeight}
        width={g.plotWidth}
        labelSize={g.labelSize}
        caption={reachText ?? ""}
      />
      <Segments segments={g.segments} />
      {g.end && (
        <circle className={styles.endDot} cx={g.end.x} cy={g.end.y} r="5" data-testid="end-dot" />
      )}
      <SymptomMarks marks={g.symptoms} />
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
  return (
    <TapLayer
      svg={svg}
      width={g.width}
      meals={day?.onMealTap ? { marks: g.meals, onTap: day.onMealTap } : null}
      symptoms={day?.onSymptomTap ? { marks: g.symptoms, onTap: day.onSymptomTap } : null}
      pump={{
        targets: g.pumpMarks.map((mark) => ({ id: mark.id, x: mark.x, name: pumpName(mark) })),
        baseline: g.plotHeight / g.height,
      }}
      timeZone={props.timeZone}
      mealHeight={`${(g.plotHeight / g.height) * 100}%`}
    />
  );
}

function MealChart(props: MealChartProps) {
  const locale = resolveLocale(useLocale());
  const t = useTranslations("chart");
  const log = useTranslations("log");
  const g = mealChartGeometry({ ...props, locale });
  const pumpT = useTranslations("pump");
  const pumpName = usePumpName();
  const reachText = g.reach ? pumpT("reach", { time: g.reach.clock }) : null;
  // The meal's own bolus with its units is named by its button; a tapped one by the chart's name.
  const own = g.bolus;
  const ownTarget =
    own?.units !== undefined
      ? {
          id: "meal-bolus",
          x: own.x,
          name: pumpName({ kind: "standard", clock: own.clock, units: own.units }),
        }
      : null;
  // The desktop label names the previous curves (Maaltid-Desktop); the phone one does not.
  const label =
    props.size === "desktop" && props.previous.length > 0
      ? t("aria.mealWithPrevious", { count: props.previous.length })
      : t("aria.meal");
  const bolusText = g.bolus && !ownTarget ? [log("bolus.at", { time: g.bolus.clock })] : [];
  const svg = (
    <svg
      className={styles.chart}
      viewBox={`0 0 ${g.width} ${g.height}`}
      width="100%"
      role="img"
      aria-label={withBoluses(label, reachText ? [...bolusText, reachText] : bolusText)}
      data-variant="meal"
      data-size={props.size}
    >
      <Band g={g} />
      {g.previous.flatMap((segments, i) =>
        segments.map((points, j) =>
          points.includes(" ") ? (
            <polyline
              key={`${i}-${j}`}
              className={styles.previousLine}
              points={points}
              opacity={g.previousOpacity}
              data-testid="previous"
            />
          ) : (
            <circle
              key={`${i}-${j}`}
              className={styles.previousPoint}
              cx={Number(points.split(",")[0])}
              cy={Number(points.split(",")[1])}
              r="1.5"
              opacity={g.previousOpacity}
              data-testid="previous-point"
            />
          ),
        ),
      )}
      <line
        className={styles.mealLine}
        x1={g.meal.x}
        y1={g.meal.top}
        x2={g.meal.x}
        y2={g.meal.bottom}
        data-testid="meal-line"
      />
      {g.symbol && (
        <MealSymbolGlyph
          symbol={g.symbol.symbol}
          x={g.symbol.x}
          y={g.symbol.y}
          size={g.symbol.size}
        />
      )}
      {g.bolus && (
        <path className={styles.bolus} d={g.bolus.path} aria-hidden="true" data-testid="bolus" />
      )}
      {g.bolus?.label && (
        <text
          className={styles.pumpLabel}
          x={g.bolus.x}
          y={g.bolus.label.y}
          fontSize={g.pumpLabelSize}
          textAnchor="middle"
          aria-hidden="true"
          data-testid="pump-label"
        >
          {g.bolus.label.text}
        </text>
      )}
      <PumpMarks marks={g.pumpMarks} labelSize={g.pumpLabelSize} />
      <PumpReach
        reach={g.reach}
        top={g.meal.top}
        bottom={g.meal.bottom}
        width={g.plotWidth}
        labelSize={g.labelSize}
        caption={reachText ?? ""}
      />
      <Segments segments={g.segments} />
      {g.end && (
        <circle className={styles.endDot} cx={g.end.x} cy={g.end.y} r="5" data-testid="end-dot" />
      )}
      <SymptomMarks marks={g.symptoms} />
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
  return (
    <TapLayer
      svg={svg}
      width={g.width}
      meals={null}
      symptoms={props.onSymptomTap ? { marks: g.symptoms, onTap: props.onSymptomTap } : null}
      pump={{
        targets: [
          ...(ownTarget ? [ownTarget] : []),
          ...g.pumpMarks.map((mark) => ({ id: mark.id, x: mark.x, name: pumpName(mark) })),
        ],
        baseline: g.meal.bottom / g.height,
      }}
      timeZone={props.timeZone}
      mealHeight="100%"
    />
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
  const svg = (
    <svg
      className={styles.chart}
      viewBox={`0 0 ${g.width} ${g.height}`}
      width="100%"
      preserveAspectRatio="none"
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
      {g.mealSymbols.map((meal, index) => (
        <MealSymbolGlyph
          key={index}
          symbol={meal.symbol}
          x={meal.x}
          y={meal.y}
          size={g.symbolSize}
        />
      ))}
      <SymptomMarks marks={g.symptoms} />
    </svg>
  );
  return (
    <TapLayer
      svg={svg}
      width={g.width}
      meals={null}
      symptoms={props.onSymptomTap ? { marks: g.symptoms, onTap: props.onSymptomTap } : null}
      timeZone={props.timeZone}
      mealHeight="100%"
    />
  );
}

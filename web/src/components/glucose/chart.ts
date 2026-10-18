// The geometry of the glucose curve (tokens.json#chart): time → x across the plot, mmol → y, the
// target band, the curve split at gaps, the end dot and the time ticks. Pure, so the sparkline
// and the day curve are tested as numbers.
import { formatUnits } from "@frejsi/shared/pump/units";
import type { MealSymbol } from "@frejsi/shared/schemas/food";
import type { GlucoseUnit, Reading } from "@frejsi/shared/schemas/index";
import type { PumpBolusKind, PumpBolusView } from "@frejsi/shared/schemas/pump";

import type { AppLocale } from "@/lib/i18n/routing";
import { formatClock } from "@/lib/i18n/time";

import { formatBound, GAP_MINUTES } from "./format";

export type ChartVariant = "sparkline" | "day";

/** From tokens.json#chart: the sparkline plot is 296 of 326 wide, the day plot 680 of 720. */
export const CHART_SIZES: Record<
  ChartVariant,
  { width: number; plotWidth: number; plotHeight: number; axisHeight: number; labelSize: number }
> = {
  sparkline: { width: 326, plotWidth: 296, plotHeight: 120, axisHeight: 20, labelSize: 11 },
  day: { width: 720, plotWidth: 680, plotHeight: 200, axisHeight: 20, labelSize: 12 },
};

/** The phone day curve (Historik-Telefon) in the curvePhone viewBox, 326×118. */
const DAY_PHONE = { width: 326, plotWidth: 296, plotHeight: 98, axisHeight: 20, labelSize: 11 };

/**
 * A meal on the day curve: its line at `ts`, a triangle at `bolusTs` when the tap exists, and
 * its food symbol (v0.6.0 plan §7) when the view carries one; without it the line is drawn bare.
 */
export interface ChartMeal {
  mealId: string;
  ts: string;
  bolusTs?: string;
  symbol?: MealSymbol;
  /** The pump bolus this meal's `bolusTs` came from: drawn once, by the pump marker (v0.7.0). */
  pumpBolusId?: string;
}

/**
 * The pump record for a curve (v0.7.0 plan §9): what the pump delivered, drawn as history with its
 * time and units, and how far the record reaches (`lastPumpAt`), so the upload's lag is never read
 * as "no bolus". Owners and carers outside simpleMode only; the screens never pass it otherwise.
 */
export interface ChartPump {
  boluses: readonly PumpBolusView[];
  reach?: string | undefined;
}

/**
 * A pump bolus on a curve: standard and extended as the terracotta triangle (`triangle`),
 * automatic and other as the 7 px hollow marker in the text colour (`hollow`,
 * tokens.json#chart.autoBolusMarker). `label` is the units above a manual triangle where the
 * curve has room for it.
 */
export interface ChartPumpMark {
  id: string;
  ts: string;
  kind: PumpBolusKind;
  shape: "triangle" | "hollow";
  units: number;
  x: number;
  path: string;
  clock: string;
  label?: { text: string; y: number };
}

/** The reach tick (tokens.json#chart.pumpReach): where the pump record ends, as a time. */
export interface ChartPumpReach {
  x: number;
  clock: string;
}

/** The units label's size above a manual triangle (v0.7.0 plan §9). */
export const PUMP_LABEL_SIZE = 11;
/** The label's baseline sits this far above the plot's baseline, clear of the triangle's apex. */
const PUMP_LABEL_LIFT = 11;

/** Only these attach to a meal; they are the meal colour's triangle on the curve. */
export function isManualBolus(kind: PumpBolusKind): boolean {
  return kind === "standard" || kind === "extended";
}

/** The 7 px hollow marker (tokens.json#chart.autoBolusMarker): apex up, base on the baseline. */
function hollowPath(x: number, baseline: number): string {
  return `M${x} ${round(baseline - 6)} L${round(x + 3.5)} ${round(baseline + 1)} H${round(x - 3.5)} Z`;
}

function pumpMark(
  bolus: PumpBolusView,
  x: number,
  baseline: number,
  timeZone: string,
  label: { locale: AppLocale } | null,
): ChartPumpMark {
  const manual = isManualBolus(bolus.kind);
  return {
    id: bolus.id,
    ts: bolus.ts,
    kind: bolus.kind,
    shape: manual ? "triangle" : "hollow",
    units: bolus.units,
    x,
    path: manual ? trianglePath(x, baseline) : hollowPath(x, baseline),
    clock: formatClock(new Date(bolus.ts), timeZone),
    ...(manual && label
      ? {
          label: {
            text: formatUnits(bolus.units, label.locale),
            y: round(baseline - PUMP_LABEL_LIFT),
          },
        }
      : {}),
  };
}

/** The newest reading's time among those the curve draws, or null. */
function newestMs(readings: readonly { ts: string }[]): number | null {
  let newest: number | null = null;
  for (const r of readings) {
    const t = new Date(r.ts).getTime();
    if (newest === null || t > newest) newest = t;
  }
  return newest;
}

/** The reach tick when the record ends inside the window and before the newest reading drawn. */
function pumpReach(
  reach: string | undefined,
  inside: (ts: string) => boolean,
  x: (ts: string) => number,
  newest: number | null,
  timeZone: string,
): ChartPumpReach | null {
  if (reach === undefined || newest === null || !inside(reach)) return null;
  if (new Date(reach).getTime() >= newest) return null;
  return { x: x(reach), clock: formatClock(new Date(reach), timeZone) };
}

/** The ids of the pump boluses in the list: a meal linked to one is drawn by the pump marker. */
function pumpIds(pump: ChartPump | undefined): Set<string> {
  return new Set((pump?.boluses ?? []).map((b) => b.id));
}

/**
 * Which bolus markers a day curve or sparkline draws, for its legend: the meal's own triangle
 * (`bolus`, "Bolus givet"), a manual pump triangle (`pumpBolus`, "Bolus (pumpe)") and a hollow
 * marker (`autoBolus`, "Automatisk bolus"). The same rules as `chartGeometry`.
 */
export function chartMarkers(input: {
  meals?: readonly ChartMeal[] | undefined;
  pump?: ChartPump | undefined;
  from: Date;
  to: Date;
}): { bolus: boolean; pumpBolus: boolean; autoBolus: boolean } {
  const fromMs = input.from.getTime();
  const toMs = input.to.getTime();
  const inside = (ts: string) => {
    const t = new Date(ts).getTime();
    return t >= fromMs && t <= toMs;
  };
  const ids = pumpIds(input.pump);
  const drawn = (input.pump?.boluses ?? []).filter((b) => inside(b.ts));
  return {
    bolus: (input.meals ?? []).some(
      (meal) =>
        meal.bolusTs !== undefined &&
        inside(meal.bolusTs) &&
        !(meal.pumpBolusId !== undefined && ids.has(meal.pumpBolusId)),
    ),
    pumpBolus: drawn.some((b) => isManualBolus(b.kind)),
    autoBolus: drawn.some((b) => !isManualBolus(b.kind)),
  };
}

/** The symbol's size at the marker: 12 px at the phone sizes, 16 px on desktop (plan §7). */
export const SYMBOL_SIZE = { phone: 12, desktop: 16 } as const;

/**
 * A symptom on a curve (v0.6.0 plan §5, decision 14): a diamond on the time axis at `ts`, named
 * by the kind's label the screen resolved ("Ondt i maven"). Never a glucose value.
 */
export interface ChartSymptom {
  id: string;
  ts: string;
  kind: string;
  label: string;
}

/** The diamond's width and height. */
export const SYMPTOM_SIZE = 10;

export interface ChartSymptomMark {
  id: string;
  ts: string;
  kind: string;
  label: string;
  x: number;
  path: string;
}

/** The 10 px diamond centred on (x, y): its corners on the axis and above and below it. */
export function diamondPath(x: number, y: number, size: number = SYMPTOM_SIZE): string {
  const half = size / 2;
  return `M${round(x)} ${round(y - half)} L${round(x + half)} ${round(y)} L${round(x)} ${round(y + half)} L${round(x - half)} ${round(y)} Z`;
}

function symptomMarks(
  symptoms: readonly ChartSymptom[] | undefined,
  inside: (ts: string) => boolean,
  x: (ts: string) => number,
  y: number,
): ChartSymptomMark[] {
  return (symptoms ?? [])
    .filter((symptom) => inside(symptom.ts))
    .map((symptom) => ({ ...symptom, x: x(symptom.ts), path: diamondPath(x(symptom.ts), y) }));
}

/** The curve never shows less than this range, so a quiet day is not drawn as a mountain. */
const MIN_DOMAIN_LOW = 2;
const MIN_DOMAIN_HIGH = 14;

export interface ChartInput {
  readings: Reading[];
  from: Date;
  to: Date;
  /** Always in mmol (plan §3); labels are converted to `unit`. */
  targetLow: number;
  targetHigh: number;
  unit: GlucoseUnit;
  timeZone: string;
  locale: AppLocale;
  variant: ChartVariant;
  /** The day variant only: `phone` draws it in the curvePhone viewBox (Historik-Telefon). */
  size?: "phone" | "desktop" | undefined;
  /** The day variant only: meal lines and bolus triangles. */
  meals?: readonly ChartMeal[] | undefined;
  /** Symptom diamonds on the time axis (plan §5). */
  symptoms?: readonly ChartSymptom[] | undefined;
  /** The pump record (v0.7.0 plan §9); the sparkline and the day curve draw it. */
  pump?: ChartPump | undefined;
}

export interface ChartGeometry {
  width: number;
  height: number;
  plotWidth: number;
  plotHeight: number;
  /** The target band, top and bottom in plot pixels, with the labels right of the plot. */
  band: { top: number; bottom: number; highLabel: string; lowLabel: string; labelX: number };
  /** One `points` string per unbroken run of readings. */
  segments: string[];
  end: { x: number; y: number } | null;
  ticks: { x: number; label: string; strong: boolean; anchor: "start" | "middle" | "end" }[];
  axisY: number;
  labelSize: number;
  /**
   * Meal lines inside the window, from `lineTop` to the baseline (`plotHeight`): `markerTop`
   * when the line is bare, just under the symbol when there is one.
   */
  meals: { mealId: string; ts: string; x: number; symbol?: MealSymbol; lineTop: number }[];
  /** Bolus triangles inside the window, on the baseline. */
  boluses: { mealId: string; x: number; path: string; clock: string }[];
  markerTop: number;
  /** The food symbol's width and height, centred on the line at `markerTop`. */
  symbolSize: number;
  /** Symptom diamonds inside the window, centred on the baseline. */
  symptoms: ChartSymptomMark[];
  /** Pump boluses inside the window, on the baseline (v0.7.0 plan §9). */
  pumpMarks: ChartPumpMark[];
  pumpLabelSize: number;
  /** The reach tick, or null when the record is not behind the newest reading in view. */
  reach: ChartPumpReach | null;
}

const round = (n: number) => Math.round(n * 10) / 10;

export function chartGeometry(input: ChartInput): ChartGeometry {
  const size =
    input.variant === "day" && input.size === "phone" ? DAY_PHONE : CHART_SIZES[input.variant];
  const fromMs = input.from.getTime();
  const span = Math.max(1, input.to.getTime() - fromMs);
  const inWindow = input.readings.filter((r) => {
    const t = new Date(r.ts).getTime();
    return t >= fromMs && t <= input.to.getTime();
  });

  const values = inWindow.map((r) => r.mmol);
  const low = Math.min(MIN_DOMAIN_LOW, ...values.map((v) => v - 0.5), input.targetLow - 1);
  const high = Math.max(MIN_DOMAIN_HIGH, ...values.map((v) => v + 0.5), input.targetHigh + 1);
  const x = (ts: string) => round(((new Date(ts).getTime() - fromMs) / span) * size.plotWidth);
  const y = (mmol: number) =>
    round(((high - Math.min(high, Math.max(low, mmol))) / (high - low)) * size.plotHeight);

  const segments = segmentsOf(inWindow, x, y);
  const toMs = input.to.getTime();
  const inside = (ts: string) => {
    const t = new Date(ts).getTime();
    return t >= fromMs && t <= toMs;
  };
  const markerTop = round(size.plotHeight * 0.1);
  const symbolSize =
    input.variant === "day" && input.size !== "phone" ? SYMBOL_SIZE.desktop : SYMBOL_SIZE.phone;
  const meals = (input.meals ?? [])
    .filter((meal) => inside(meal.ts))
    .map((meal) => ({
      mealId: meal.mealId,
      ts: meal.ts,
      x: x(meal.ts),
      ...(meal.symbol !== undefined ? { symbol: meal.symbol } : {}),
      lineTop: meal.symbol !== undefined ? round(markerTop + symbolSize / 2 + 2) : markerTop,
    }));
  const linked = pumpIds(input.pump);
  const boluses = (input.meals ?? []).flatMap((meal) =>
    meal.bolusTs !== undefined &&
    inside(meal.bolusTs) &&
    !(meal.pumpBolusId !== undefined && linked.has(meal.pumpBolusId))
      ? [
          {
            mealId: meal.mealId,
            x: x(meal.bolusTs),
            path: trianglePath(x(meal.bolusTs), size.plotHeight),
            clock: formatClock(new Date(meal.bolusTs), input.timeZone),
          },
        ]
      : [],
  );

  const last = inWindow.at(-1);
  const end = last ? { x: x(last.ts), y: y(last.mmol) } : null;
  // Units above the manual triangles on the desktop day curve only; the phone opens a popover.
  const labelled = input.variant === "day" && input.size !== "phone";
  const pumpMarks = (input.pump?.boluses ?? [])
    .filter((bolus) => inside(bolus.ts))
    .map((bolus) =>
      pumpMark(
        bolus,
        x(bolus.ts),
        size.plotHeight,
        input.timeZone,
        labelled ? { locale: input.locale } : null,
      ),
    );

  return {
    width: size.width,
    height: size.plotHeight + size.axisHeight,
    plotWidth: size.plotWidth,
    plotHeight: size.plotHeight,
    band: {
      top: y(input.targetHigh),
      bottom: y(input.targetLow),
      highLabel: formatBound(input.targetHigh, input.unit, input.locale),
      lowLabel: formatBound(input.targetLow, input.unit, input.locale),
      labelX: size.plotWidth + 8,
    },
    segments,
    end,
    ticks: ticksFor(input, size.plotWidth),
    axisY: size.plotHeight + size.axisHeight - 4,
    labelSize: size.labelSize,
    meals,
    boluses,
    markerTop,
    symbolSize,
    symptoms: symptomMarks(input.symptoms, inside, x, size.plotHeight),
    pumpMarks,
    pumpLabelSize: PUMP_LABEL_SIZE,
    reach: pumpReach(input.pump?.reach, inside, x, newestMs(inWindow), input.timeZone),
  };
}

/** One `points` string per unbroken run; a gap longer than `GAP_MINUTES` starts a new run (gap 5). */
function segmentsOf(
  points: readonly { ts: string; mmol: number }[],
  x: (ts: string) => number,
  y: (mmol: number) => number,
  gapMinutes: number = GAP_MINUTES,
): string[] {
  const segments: string[] = [];
  let current: string[] = [];
  let previousMs: number | null = null;
  for (const point of points) {
    const t = new Date(point.ts).getTime();
    if (previousMs !== null && t - previousMs > gapMinutes * 60_000 && current.length > 0) {
      segments.push(current.join(" "));
      current = [];
    }
    current.push(`${x(point.ts)},${y(point.mmol)}`);
    previousMs = t;
  }
  if (current.length > 0) segments.push(current.join(" "));
  return segments;
}

/** The 10 px bolus triangle (tokens.json#chart.bolusTriangle): apex up, base on the baseline. */
function trianglePath(x: number, baseline: number): string {
  return `M${x} ${round(baseline - 8)} L${round(x + 5)} ${round(baseline + 2)} H${round(x - 5)} Z`;
}

// ---------------------------------------------------------------------------------------------
// The meal curve (v0.3.0 plan §7): −1 h to +4 h around the meal, y fixed from 2 to 20 mmol/L.

export const CHART_BEFORE_MINUTES = 60;
export const CHART_AFTER_MINUTES = 240;
/** The meal and week curves share one fixed scale; a value above the top sits on the edge (gap 5). */
export const Y_MIN = 2;
export const Y_MAX = 20;

export type MealChartSize = "phone" | "desktop";

/** From tokens.json#chart: curvePhone 326×118 and curveDesktopMeal 760×262 (Maaltid-*). */
export const MEAL_CHART_SIZES: Record<
  MealChartSize,
  {
    width: number;
    height: number;
    plotWidth: number;
    plotTop: number;
    baseline: number;
    labelX: number;
    axisY: number;
    labelSize: number;
    previousOpacity: number;
  }
> = {
  phone: {
    width: 326,
    height: 118,
    plotWidth: 296,
    plotTop: 10,
    baseline: 100,
    labelX: 304,
    axisY: 114,
    labelSize: 11,
    previousOpacity: 0.18,
  },
  desktop: {
    width: 760,
    height: 262,
    plotWidth: 720,
    plotTop: 30,
    baseline: 234,
    labelX: 730,
    axisY: 256,
    labelSize: 12,
    previousOpacity: 0.16,
  },
};

/** An earlier occurrence of the same dish: its own meal time and its own readings. */
export interface PreviousCurve {
  mealTs: string;
  readings: readonly Reading[];
}

export interface MealChartInput {
  readings: readonly Reading[];
  mealTs: string;
  bolusTs?: string;
  /** The pump bolus the meal's `bolusTs` came from (v0.7.0): its units label the triangle. */
  pumpBolusId?: string | undefined;
  /** The meal's linked bolus units from the meal view, used while the pump list is not there. */
  bolusUnits?: number | undefined;
  /** The pump record: the automatic and other boluses in the window are hollow markers. */
  pump?: ChartPump | undefined;
  /** The meal's food symbol, drawn above the plot on the meal line (plan §7). */
  symbol?: MealSymbol;
  /** Symptoms; those within the −1 h/+4 h window are drawn on the axis (plan §5). */
  symptoms?: readonly ChartSymptom[] | undefined;
  previous: readonly PreviousCurve[];
  /** In mmol; the labels are drawn in `unit`. */
  target: { low: number; high: number };
  unit: GlucoseUnit;
  locale: AppLocale;
  timeZone: string;
  size: MealChartSize;
  /** Readings after `now` are not drawn. */
  now: Date;
}

export interface MealChartGeometry {
  width: number;
  height: number;
  plotWidth: number;
  band: ChartGeometry["band"];
  segments: string[];
  end: { x: number; y: number } | null;
  /** One list of segments per previous occurrence, each positioned relative to its own meal. */
  previous: string[][];
  previousOpacity: number;
  meal: { x: number; top: number; bottom: number };
  /** The symbol's box, its bottom at `plotTop` (clamped to the top edge on the phone). */
  symbol: { symbol: MealSymbol; x: number; y: number; size: number } | null;
  mealClock: string;
  /** The meal's own bolus; with `units` and `label` when it came from the pump (v0.7.0). */
  bolus: {
    x: number;
    path: string;
    clock: string;
    units?: number;
    label?: { text: string; y: number };
  } | null;
  /** The hollow markers: automatic and other pump boluses in the window (v0.7.0 plan §9). */
  pumpMarks: ChartPumpMark[];
  pumpLabelSize: number;
  reach: ChartPumpReach | null;
  /** Hours relative to the meal, −1 to +4; 0 is the meal time. */
  ticks: { hours: number; x: number; anchor: "start" | "middle" | "end" }[];
  axisY: number;
  labelSize: number;
  symptoms: ChartSymptomMark[];
}

const WINDOW_MINUTES = CHART_BEFORE_MINUTES + CHART_AFTER_MINUTES;

function fixedY(top: number, baseline: number) {
  return (mmol: number) => {
    const clamped = Math.min(Y_MAX, Math.max(Y_MIN, mmol));
    return round(baseline - ((clamped - Y_MIN) / (Y_MAX - Y_MIN)) * (baseline - top));
  };
}

/** x across the plot for a time relative to `mealTs`, over the −1 h/+4 h window. */
function mealX(mealTs: string, plotWidth: number) {
  const start = new Date(mealTs).getTime() - CHART_BEFORE_MINUTES * 60_000;
  return (ts: string) =>
    round(((new Date(ts).getTime() - start) / (WINDOW_MINUTES * 60_000)) * plotWidth);
}

/** Whether `ts` falls in the −1 h/+4 h window around `mealTs`. */
function inMealWindowAt(mealTs: string, ts: string): boolean {
  const mealMs = new Date(mealTs).getTime();
  const t = new Date(ts).getTime();
  return t >= mealMs - CHART_BEFORE_MINUTES * 60_000 && t <= mealMs + CHART_AFTER_MINUTES * 60_000;
}

function inMealWindow(mealTs: string, readings: readonly Reading[], until?: number) {
  const mealMs = new Date(mealTs).getTime();
  const from = mealMs - CHART_BEFORE_MINUTES * 60_000;
  const to = Math.min(mealMs + CHART_AFTER_MINUTES * 60_000, until ?? Infinity);
  return readings
    .filter((r) => {
      const t = new Date(r.ts).getTime();
      return t >= from && t <= to;
    })
    .toSorted((a, b) => a.ts.localeCompare(b.ts));
}

export function mealChartGeometry(input: MealChartInput): MealChartGeometry {
  const size = MEAL_CHART_SIZES[input.size];
  const x = mealX(input.mealTs, size.plotWidth);
  const y = fixedY(size.plotTop, size.baseline);
  const readings = inMealWindow(input.mealTs, input.readings, input.now.getTime());
  const last = readings.at(-1);
  const inside = (ts: string) => inMealWindowAt(input.mealTs, ts);
  const own =
    input.pumpBolusId === undefined
      ? undefined
      : input.pump?.boluses.find((bolus) => bolus.id === input.pumpBolusId);
  const ownUnits = input.pumpBolusId === undefined ? undefined : (own?.units ?? input.bolusUnits);
  // A tap outside the −1 h/+4 h window is not drawn: the chart has no place for it.
  const bolusX =
    input.bolusTs !== undefined && inMealWindowAt(input.mealTs, input.bolusTs)
      ? x(input.bolusTs)
      : null;
  return {
    width: size.width,
    height: size.height,
    plotWidth: size.plotWidth,
    band: {
      top: y(input.target.high),
      bottom: y(input.target.low),
      highLabel: formatBound(input.target.high, input.unit, input.locale),
      lowLabel: formatBound(input.target.low, input.unit, input.locale),
      labelX: size.labelX,
    },
    segments: segmentsOf(readings, x, y),
    end: last ? { x: x(last.ts), y: y(last.mmol) } : null,
    previous: input.previous.map((p) =>
      segmentsOf(inMealWindow(p.mealTs, p.readings), mealX(p.mealTs, size.plotWidth), y),
    ),
    previousOpacity: size.previousOpacity,
    meal: { x: x(input.mealTs), top: size.plotTop, bottom: size.baseline },
    symbol:
      input.symbol === undefined
        ? null
        : {
            symbol: input.symbol,
            x: round(x(input.mealTs) - SYMBOL_SIZE[input.size] / 2),
            y: Math.max(0, size.plotTop - SYMBOL_SIZE[input.size]),
            size: SYMBOL_SIZE[input.size],
          },
    mealClock: formatClock(new Date(input.mealTs), input.timeZone),
    bolus:
      bolusX === null || input.bolusTs === undefined
        ? null
        : {
            x: bolusX,
            path: trianglePath(bolusX, size.baseline),
            clock: formatClock(new Date(input.bolusTs), input.timeZone),
            ...(ownUnits !== undefined
              ? {
                  units: ownUnits,
                  label: {
                    text: formatUnits(ownUnits, input.locale),
                    y: round(size.baseline - PUMP_LABEL_LIFT),
                  },
                }
              : {}),
          },
    pumpMarks: mealPumpBoluses(input.mealTs, input.pump, input.pumpBolusId).map((bolus) =>
      pumpMark(bolus, x(bolus.ts), size.baseline, input.timeZone, null),
    ),
    pumpLabelSize: PUMP_LABEL_SIZE,
    reach: pumpReach(input.pump?.reach, inside, x, newestMs(readings), input.timeZone),
    ticks: [-1, 0, 1, 2, 3, 4].map((hours) => ({
      hours,
      x: round(((hours + 1) / 5) * size.plotWidth),
      anchor: hours === -1 ? "start" : hours === 4 ? "end" : "middle",
    })),
    axisY: size.axisY,
    labelSize: size.labelSize,
    symptoms: symptomMarks(
      input.symptoms,
      (ts) => inMealWindowAt(input.mealTs, ts),
      x,
      size.baseline,
    ),
  };
}

/**
 * The pump boluses a meal curve draws besides its own: the automatic and other ones in its window.
 * A standard or extended bolus there belongs to a meal of its own and is drawn on that meal's curve.
 */
function mealPumpBoluses(
  mealTs: string,
  pump: ChartPump | undefined,
  ownId: string | undefined,
): PumpBolusView[] {
  return (pump?.boluses ?? []).filter(
    (bolus) => bolus.id !== ownId && !isManualBolus(bolus.kind) && inMealWindowAt(mealTs, bolus.ts),
  );
}

/** Which pump markers a meal curve draws besides its own bolus, for its legend. */
export function mealChartMarkers(input: {
  mealTs: string;
  pump?: ChartPump | undefined;
  pumpBolusId?: string | undefined;
}): { autoBolus: boolean } {
  return { autoBolus: mealPumpBoluses(input.mealTs, input.pump, input.pumpBolusId).length > 0 };
}

// ---------------------------------------------------------------------------------------------
// The week tile (tokens.json#chart.weekTile, Historik-Desktop): one day in 120×64.

export const WEEK_TILE = {
  width: 120,
  height: 64,
  plotTop: 2,
  baseline: 52,
  dotY: 58,
  /** The food symbol in place of the dot (plan §7), centred on `dotY`. */
  symbolSize: 8,
  /** The symptom diamond's centre, on the tile's bottom edge under the meals (plan §5). */
  symptomY: 59,
  maxPoints: 48,
};

export interface WeekTileInput {
  /** The viewBox width: 120 on the desktop grid; the phone passes a wider tile for its card. */
  width?: number;
  /** The day downsampled to 30-minute buckets (plan §5), at most 48 points. */
  curve: readonly { ts: string; mmol: number }[];
  mealTimes: readonly string[];
  /** When given, the meals are drawn as their symbols instead of dots (v0.6.0 plan §7). */
  meals?: readonly { ts: string; symbol: MealSymbol }[] | undefined;
  symptoms?: readonly ChartSymptom[] | undefined;
  /** The local day, 00:00 to 24:00 in the space's zone. */
  from: Date;
  to: Date;
  target: { low: number; high: number };
}

export interface WeekTileGeometry {
  width: number;
  height: number;
  band: { top: number; bottom: number };
  segments: string[];
  /** The meal dots: empty when `meals` was given. */
  mealDots: { x: number; y: number }[];
  /** The symbols' boxes (top-left corner), `symbolSize` wide, centred on `dotY`. */
  mealSymbols: { x: number; y: number; symbol: MealSymbol }[];
  symbolSize: number;
  symptoms: ChartSymptomMark[];
}

export function weekTileGeometry(input: WeekTileInput): WeekTileGeometry {
  const width = input.width ?? WEEK_TILE.width;
  const fromMs = input.from.getTime();
  const span = Math.max(1, input.to.getTime() - fromMs);
  const x = (ts: string) => round(((new Date(ts).getTime() - fromMs) / span) * width);
  const y = fixedY(WEEK_TILE.plotTop, WEEK_TILE.baseline);
  const inDay = input.curve
    .filter((p) => {
      const t = new Date(p.ts).getTime();
      return t >= fromMs && t <= input.to.getTime();
    })
    .toSorted((a, b) => a.ts.localeCompare(b.ts));
  const step = Math.ceil(inDay.length / WEEK_TILE.maxPoints);
  const points = step > 1 ? inDay.filter((_, i) => i % step === 0) : inDay;
  // Buckets are 30 minutes apart (plan §5): a missing bucket is a gap in the line.
  const bucketMinutes = span / 60_000 / WEEK_TILE.maxPoints;
  const gapMinutes = Math.max(GAP_MINUTES, bucketMinutes * 1.5);
  const inDayAt = (ts: string) => {
    const t = new Date(ts).getTime();
    return t >= fromMs && t <= input.to.getTime();
  };
  const half = WEEK_TILE.symbolSize / 2;
  return {
    width,
    height: WEEK_TILE.height,
    band: { top: y(input.target.high), bottom: y(input.target.low) },
    segments: segmentsOf(points, x, y, gapMinutes * Math.max(1, step)),
    mealDots: input.meals
      ? []
      : input.mealTimes.filter(inDayAt).map((ts) => ({ x: x(ts), y: WEEK_TILE.dotY })),
    mealSymbols: (input.meals ?? [])
      .filter((meal) => inDayAt(meal.ts))
      .map((meal) => ({
        x: round(x(meal.ts) - half),
        y: WEEK_TILE.dotY - half,
        symbol: meal.symbol,
      })),
    symbolSize: WEEK_TILE.symbolSize,
    symptoms: symptomMarks(input.symptoms, inDayAt, x, WEEK_TILE.symptomY),
  };
}

/**
 * Hour ticks (every hour on the sparkline, every two on the day curve, every six on the phone day
 * curve so a whole day fits 296 px: 00 · 06 · 12 · 18, plan decision 7) with "now" at the right
 * edge in bold, as the artboards draw "13:00 · 14:00 · 15:13". A tick within 30 minutes of the
 * end is dropped so the two labels do not collide.
 */
function ticksFor(input: ChartInput, plotWidth: number): ChartGeometry["ticks"] {
  const hours = input.variant === "day" ? (input.size === "phone" ? 6 : 2) : 1;
  const stepMs = hours * 60 * 60 * 1000;
  const fromMs = input.from.getTime();
  const toMs = input.to.getTime();
  const span = Math.max(1, toMs - fromMs);
  const ticks: ChartGeometry["ticks"] = [];
  // The first full hour at or after `from`, in the space's zone (hours are zone-aligned).
  const first = firstFullHour(input.from, input.timeZone);
  for (let t = first; t <= toMs - 30 * 60_000; t += stepMs) {
    const xPos = round(((t - fromMs) / span) * plotWidth);
    ticks.push({
      x: xPos,
      label: formatClock(new Date(t), input.timeZone),
      strong: false,
      anchor: xPos < 20 ? "start" : "middle",
    });
  }
  ticks.push({
    x: plotWidth,
    label: formatClock(input.to, input.timeZone),
    strong: true,
    anchor: "end",
  });
  return ticks;
}

function firstFullHour(from: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    minute: "2-digit",
    second: "2-digit",
    timeZone,
  }).formatToParts(from);
  const value = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const intoHourMs = (value("minute") * 60 + value("second")) * 1000;
  return intoHourMs === 0 ? from.getTime() : from.getTime() - intoHourMs + 60 * 60 * 1000;
}

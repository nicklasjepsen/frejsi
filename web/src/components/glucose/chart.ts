// The geometry of the glucose curve (tokens.json#chart): time → x across the plot, mmol → y, the
// target band, the curve split at gaps, the end dot and the time ticks. Pure, so the sparkline
// and the day curve are tested as numbers.
import { fromMmol, type GlucoseUnit, type Reading } from "@frejsi/shared";

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
}

const round = (n: number) => Math.round(n * 10) / 10;

export function chartGeometry(input: ChartInput): ChartGeometry {
  const size = CHART_SIZES[input.variant];
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

  const segments: string[] = [];
  let current: string[] = [];
  let previous: Reading | null = null;
  for (const reading of inWindow) {
    const gap =
      previous &&
      new Date(reading.ts).getTime() - new Date(previous.ts).getTime() > GAP_MINUTES * 60_000;
    if (gap && current.length > 0) {
      segments.push(current.join(" "));
      current = [];
    }
    current.push(`${x(reading.ts)},${y(reading.mmol)}`);
    previous = reading;
  }
  if (current.length > 0) segments.push(current.join(" "));

  const last = inWindow.at(-1);
  const end = last ? { x: x(last.ts), y: y(last.mmol) } : null;

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
  };
}

/**
 * Hour ticks (every hour on the sparkline, every two on the day curve) with "now" at the right
 * edge in bold, as the artboards draw "13:00 · 14:00 · 15:13". A tick within 30 minutes of the
 * end is dropped so the two labels do not collide.
 */
function ticksFor(input: ChartInput, plotWidth: number): ChartGeometry["ticks"] {
  const stepMs = (input.variant === "day" ? 2 : 1) * 60 * 60 * 1000;
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

/** The unit label the chart header shows next to "Mål 4–10" on desktop. */
export function unitOf(unit: GlucoseUnit, mmol: number): number {
  return fromMmol(mmol, unit);
}

import type { Reading } from "@frejsi/shared";
import { describe, expect, it } from "vitest";

import { chartGeometry, mealChartGeometry, weekTileGeometry, type MealChartInput } from "./chart";

const MEAL = "2026-10-14T10:10:00.000Z"; // 12:10 Copenhagen
const at = (base: string, minutes: number) =>
  new Date(new Date(base).getTime() + minutes * 60_000).toISOString();
const reading = (ts: string, mmol: number): Reading => ({ ts, mmol, trend: "flat" });
/** Every 5 minutes from `from` to `to` minutes around `base`, at a constant value. */
const series = (base: string, from: number, to: number, mmol = 6): Reading[] => {
  const out: Reading[] = [];
  for (let m = from; m <= to; m += 5) out.push(reading(at(base, m), mmol));
  return out;
};

const input: MealChartInput = {
  readings: [],
  mealTs: MEAL,
  previous: [],
  target: { low: 4, high: 10 },
  unit: "mmol",
  locale: "da",
  timeZone: "Europe/Copenhagen",
  size: "phone",
  now: new Date(at(MEAL, 300)),
};

describe("mealChartGeometry (tokens.json#chart, Maaltid-Telefon, Maaltid-Desktop)", () => {
  it("uses the curvePhone and curveDesktopMeal viewBoxes with the bound labels right of the plot", () => {
    const phone = mealChartGeometry(input);
    expect([phone.width, phone.height, phone.plotWidth, phone.band.labelX]).toEqual([
      326, 118, 296, 304,
    ]);
    const desktop = mealChartGeometry({ ...input, size: "desktop" });
    expect([desktop.width, desktop.height, desktop.plotWidth, desktop.band.labelX]).toEqual([
      760, 262, 720, 730,
    ]);
    expect(phone.labelSize).toBe(11);
    expect(desktop.labelSize).toBe(12);
  });

  it("scales y linearly from 2 to 20 mmol/L between the baseline and the top edge", () => {
    const g = mealChartGeometry(input);
    // Phone: baseline 100, top 10, so 5 px per mmol/L: 10 → 60, 4 → 90.
    expect(g.band).toMatchObject({ top: 60, bottom: 90, highLabel: "10", lowLabel: "4" });
  });

  it("puts the meal line at meal.ts and the axis at −1 t, the meal time, +1 … +4 t", () => {
    const g = mealChartGeometry(input);
    expect(g.meal).toEqual({ x: 59.2, top: 10, bottom: 100 });
    expect(g.ticks.map((t) => [t.hours, t.x, t.anchor])).toEqual([
      [-1, 0, "start"],
      [0, 59.2, "middle"],
      [1, 118.4, "middle"],
      [2, 177.6, "middle"],
      [3, 236.8, "middle"],
      [4, 296, "end"],
    ]);
    expect(g.mealClock).toBe("12:10");
  });

  it("draws the bolus triangle on the baseline at bolusTs, and none without one", () => {
    expect(mealChartGeometry(input).bolus).toBeNull();
    const g = mealChartGeometry({ ...input, bolusTs: at(MEAL, -12) });
    // 12 min before 12:10 is 48 min into the 300-minute window: 296 × 48 / 300 = 47.4.
    expect(g.bolus).toEqual({ x: 47.4, path: "M47.4 92 L52.4 102 H42.4 Z", clock: "11:58" });
  });

  it("draws the curve with the end dot on the latest reading", () => {
    const g = mealChartGeometry({ ...input, readings: series(MEAL, -60, 80, 6) });
    expect(g.segments).toHaveLength(1);
    expect(g.segments[0]?.startsWith("0,80 ")).toBe(true);
    expect(g.end).toEqual({ x: 138.1, y: 80 });
  });

  it("breaks the line at a gap longer than 15 minutes", () => {
    const readings = [...series(MEAL, -60, 0), ...series(MEAL, 30, 60)];
    expect(mealChartGeometry({ ...input, readings }).segments).toHaveLength(2);
    const fifteen = [...series(MEAL, -60, 0), ...series(MEAL, 15, 60)];
    expect(mealChartGeometry({ ...input, readings: fifteen }).segments).toHaveLength(1);
  });

  it("clamps a reading above 20 mmol/L to the top edge", () => {
    const g = mealChartGeometry({
      ...input,
      readings: [reading(at(MEAL, 0), 24), reading(at(MEAL, 5), 2.2)],
    });
    expect(g.segments[0]).toBe("59.2,10 64.1,99");
  });

  it("draws the band and the axis but no line for a window without readings", () => {
    const g = mealChartGeometry({ ...input, readings: [reading(at(MEAL, -200), 6)] });
    expect(g.segments).toEqual([]);
    expect(g.end).toBeNull();
    expect(g.ticks).toHaveLength(6);
  });

  it("leaves out readings after now", () => {
    const g = mealChartGeometry({
      ...input,
      readings: series(MEAL, -60, 240),
      now: new Date(at(MEAL, 30)),
    });
    expect(g.end?.x).toBe(88.8);
  });

  it("labels a mg/dL space's bounds in mg/dL", () => {
    const g = mealChartGeometry({ ...input, unit: "mgdl", target: { low: 3.9, high: 10 } });
    expect([g.band.highLabel, g.band.lowLabel]).toEqual(["180", "70"]);
  });

  it("positions each previous series relative to its own meal ts", () => {
    const earlier = "2026-10-12T16:40:00.000Z";
    const g = mealChartGeometry({
      ...input,
      previous: [{ mealTs: earlier, readings: series(earlier, -60, 240) }],
    });
    expect(g.previous).toHaveLength(1);
    expect(g.previous[0]?.[0]?.startsWith("0,80 ")).toBe(true);
    expect(g.previous[0]?.[0]?.endsWith(" 296,80")).toBe(true);
    expect(g.previousOpacity).toBe(0.18);
    expect(mealChartGeometry({ ...input, size: "desktop" }).previousOpacity).toBe(0.16);
  });
});

describe("weekTileGeometry (tokens.json#chart.weekTile, Historik-Desktop)", () => {
  const from = new Date("2026-10-05T22:00:00.000Z"); // Tuesday 6 October, 00:00 Copenhagen
  const to = new Date("2026-10-06T22:00:00.000Z");
  const curve = Array.from({ length: 48 }, (_, i) => ({
    ts: new Date(from.getTime() + i * 30 * 60_000).toISOString(),
    mmol: 6,
  }));

  it("draws the 120×64 tile, a polyline over at most 48 points and the meal dots on the baseline", () => {
    const g = weekTileGeometry({
      curve,
      mealTimes: ["2026-10-06T06:00:00.000Z"],
      from,
      to,
      target: { low: 4, high: 10 },
    });
    expect([g.width, g.height]).toEqual([120, 64]);
    expect(g.segments).toHaveLength(1);
    expect(g.segments[0]?.split(" ")).toHaveLength(48);
    expect(g.mealDots).toEqual([{ x: 40, y: 58 }]);
    expect(g.band.top).toBeLessThan(g.band.bottom);
  });

  it("thins a longer series to 48 points", () => {
    const dense = Array.from({ length: 288 }, (_, i) => ({
      ts: new Date(from.getTime() + i * 5 * 60_000).toISOString(),
      mmol: 6,
    }));
    const g = weekTileGeometry({
      curve: dense,
      mealTimes: [],
      from,
      to,
      target: { low: 4, high: 10 },
    });
    expect(g.segments.join(" ").split(" ").length).toBeLessThanOrEqual(48);
  });
});

describe("chartGeometry day variant: meal lines and bolus triangles", () => {
  const from = new Date("2026-10-14T04:00:00.000Z"); // 06:00
  const to = new Date("2026-10-14T13:13:00.000Z");
  it("places a line per meal and a triangle per bolus inside the window", () => {
    const g = chartGeometry({
      readings: [],
      from,
      to,
      targetLow: 4,
      targetHigh: 10,
      unit: "mmol",
      timeZone: "Europe/Copenhagen",
      locale: "da",
      variant: "day",
      meals: [
        { mealId: "m1", ts: MEAL, bolusTs: at(MEAL, -12) },
        { mealId: "old", ts: "2026-10-13T10:00:00.000Z" },
      ],
    });
    expect(g.meals.map((m) => m.mealId)).toEqual(["m1"]);
    expect(g.meals[0]?.x).toBeCloseTo((370 / 553) * 680, 0);
    expect(g.boluses).toHaveLength(1);
    expect(g.boluses[0]?.clock).toBe("11:58");
  });

  it("has a phone size in the curvePhone viewBox", () => {
    const g = chartGeometry({
      readings: [],
      from,
      to,
      targetLow: 4,
      targetHigh: 10,
      unit: "mmol",
      timeZone: "Europe/Copenhagen",
      locale: "da",
      variant: "day",
      size: "phone",
    });
    expect([g.width, g.height, g.plotWidth]).toEqual([326, 118, 296]);
  });
});

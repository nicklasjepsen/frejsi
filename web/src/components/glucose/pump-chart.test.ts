import type { Reading } from "@frejsi/shared";
import type { PumpBolusView } from "@frejsi/shared/schemas/pump";
import { describe, expect, it } from "vitest";

import {
  chartGeometry,
  chartMarkers,
  mealChartGeometry,
  mealChartMarkers,
  type ChartInput,
  type MealChartInput,
} from "./chart";

// 2026-10-15, Copenhagen is UTC+2: 06:00 local is 04:00Z, 15:13 local is 13:13Z.
const FROM = new Date("2026-10-15T04:00:00.000Z");
const T0 = new Date("2026-10-15T13:13:00.000Z");
const reading = (ts: string, mmol = 6): Reading => ({ ts, mmol, trend: "flat" });

const bolus = (
  id: string,
  ts: string,
  units: number,
  kind: PumpBolusView["kind"],
  mealId?: string,
): PumpBolusView => ({ id, ts, units, kind, ...(mealId ? { mealId } : {}) });

const auto = bolus("auto", "2026-10-15T05:10:00.000Z", 0.6, "automatic"); // 07:10
const early = bolus("early", "2026-10-15T03:00:00.000Z", 1, "standard"); // 05:00, before the window
const boluses: PumpBolusView[] = [
  auto,
  bolus("ext", "2026-10-15T07:30:00.000Z", 1.25, "extended"), // 09:30
  bolus("lunch", "2026-10-15T09:58:00.000Z", 2.4, "standard", "m-lunch"), // 11:58
  bolus("odd", "2026-10-15T11:00:00.000Z", 0.3, "other"), // 13:00
  early,
];

const day: ChartInput = {
  readings: [reading("2026-10-15T12:00:00.000Z"), reading("2026-10-15T13:10:00.000Z")],
  from: FROM,
  to: T0,
  targetLow: 4,
  targetHigh: 10,
  unit: "mmol",
  timeZone: "Europe/Copenhagen",
  locale: "da",
  variant: "day",
  size: "desktop",
};

describe("pump markers on the day curve (v0.7.0 plan §9)", () => {
  it("draws standard and extended boluses as the 10 px triangle and the others as the 7 px hollow marker", () => {
    const g = chartGeometry({ ...day, pump: { boluses } });
    expect(g.pumpMarks.map((m) => [m.id, m.shape, m.clock, m.units, m.kind])).toEqual([
      ["auto", "hollow", "07:10", 0.6, "automatic"],
      ["ext", "triangle", "09:30", 1.25, "extended"],
      ["lunch", "triangle", "11:58", 2.4, "standard"],
      ["odd", "hollow", "13:00", 0.3, "other"],
    ]);
    const lunch = g.pumpMarks.find((m) => m.id === "lunch");
    const x = lunch?.x ?? 0;
    expect(lunch?.path).toBe(
      `M${x} 192 L${Math.round((x + 5) * 10) / 10} 202 H${Math.round((x - 5) * 10) / 10} Z`,
    );
    const auto = g.pumpMarks.find((m) => m.id === "auto");
    const ax = auto?.x ?? 0;
    expect(auto?.path).toBe(
      `M${ax} 194 L${Math.round((ax + 3.5) * 10) / 10} 201 H${Math.round((ax - 3.5) * 10) / 10} Z`,
    );
  });

  it("does not draw a meal's own triangle again when its pumpBolusId is in the list, and still draws a tapped one", () => {
    const g = chartGeometry({
      ...day,
      meals: [
        {
          mealId: "m-lunch",
          ts: "2026-10-15T10:05:00.000Z",
          bolusTs: "2026-10-15T09:58:00.000Z",
          pumpBolusId: "lunch",
        },
        { mealId: "m-old", ts: "2026-10-15T06:00:00.000Z", bolusTs: "2026-10-15T05:50:00.000Z" },
      ],
      pump: { boluses },
    });
    expect(g.boluses.map((b) => b.mealId)).toEqual(["m-old"]);
    expect(g.pumpMarks.filter((m) => m.id === "lunch")).toHaveLength(1);
  });

  it("draws the meal's own triangle while the pump list does not hold its bolus", () => {
    const g = chartGeometry({
      ...day,
      meals: [
        {
          mealId: "m-lunch",
          ts: "2026-10-15T10:05:00.000Z",
          bolusTs: "2026-10-15T09:58:00.000Z",
          pumpBolusId: "lunch",
        },
      ],
    });
    expect(g.boluses.map((b) => b.mealId)).toEqual(["m-lunch"]);
    expect(g.pumpMarks).toEqual([]);
  });

  it("labels each manual triangle with its units on the desktop day curve only", () => {
    const desktop = chartGeometry({ ...day, pump: { boluses } });
    expect(desktop.pumpMarks.map((m) => [m.id, m.label?.text ?? null])).toEqual([
      ["auto", null],
      ["ext", "1,25 E"],
      ["lunch", "2,4 E"],
      ["odd", null],
    ]);
    expect(desktop.pumpMarks.find((m) => m.id === "lunch")?.label?.y).toBe(189);
    expect(desktop.pumpLabelSize).toBe(11);
    const en = chartGeometry({ ...day, locale: "en", pump: { boluses } });
    expect(en.pumpMarks.find((m) => m.id === "lunch")?.label?.text).toBe("2.4 U");
    const phone = chartGeometry({ ...day, size: "phone", pump: { boluses } });
    expect(phone.pumpMarks.every((m) => m.label === undefined)).toBe(true);
    const sparkline = chartGeometry({
      ...day,
      variant: "sparkline",
      from: new Date(T0.getTime() - 4 * 60 * 60_000),
      pump: { boluses },
    });
    expect(sparkline.pumpMarks.map((m) => m.id)).toEqual(["lunch", "odd"]);
    expect(sparkline.pumpMarks.every((m) => m.label === undefined)).toBe(true);
  });

  it("puts the reach tick where the record ends, only inside the window and older than the newest reading", () => {
    const at = (reach: string) => chartGeometry({ ...day, pump: { boluses, reach } }).reach;
    expect(at("2026-10-15T09:58:00.000Z")).toMatchObject({ clock: "11:58" });
    expect(at("2026-10-15T09:58:00.000Z")?.x).toBe(
      chartGeometry({ ...day, pump: { boluses } }).pumpMarks.find((m) => m.id === "lunch")?.x,
    );
    // As new as the newest reading, or newer: the record is not behind, nothing to say.
    expect(at("2026-10-15T13:10:00.000Z")).toBeNull();
    expect(at("2026-10-15T13:12:00.000Z")).toBeNull();
    // Before the window: the tick has no place on the curve.
    expect(at("2026-10-15T03:00:00.000Z")).toBeNull();
    expect(
      chartGeometry({ ...day, readings: [], pump: { boluses, reach: "2026-10-15T09:58:00.000Z" } })
        .reach,
    ).toBeNull();
    expect(chartGeometry({ ...day, pump: { boluses } }).reach).toBeNull();
  });

  it("has no pump marks and no reach without pump props, and nothing else changes", () => {
    const without = chartGeometry(day);
    expect(without.pumpMarks).toEqual([]);
    expect(without.reach).toBeNull();
    const withEmpty = chartGeometry({ ...day, pump: { boluses: [] } });
    expect({ ...withEmpty, pumpMarks: [], reach: null }).toEqual(without);
  });

  it("tells the legend which markers the curve draws", () => {
    const meals = [
      {
        mealId: "m-lunch",
        ts: "2026-10-15T10:05:00.000Z",
        bolusTs: "2026-10-15T09:58:00.000Z",
        pumpBolusId: "lunch",
      },
    ];
    expect(chartMarkers({ meals, from: FROM, to: T0 })).toEqual({
      bolus: true,
      pumpBolus: false,
      autoBolus: false,
    });
    expect(chartMarkers({ meals, pump: { boluses }, from: FROM, to: T0 })).toEqual({
      bolus: false,
      pumpBolus: true,
      autoBolus: true,
    });
    expect(chartMarkers({ pump: { boluses: [auto] }, from: FROM, to: T0 })).toEqual({
      bolus: false,
      pumpBolus: false,
      autoBolus: true,
    });
    // Only what lies inside the window counts.
    expect(chartMarkers({ pump: { boluses: [early] }, from: FROM, to: T0 })).toEqual({
      bolus: false,
      pumpBolus: false,
      autoBolus: false,
    });
  });
});

const MEAL = "2026-10-15T10:05:00.000Z"; // 12:05
const meal: MealChartInput = {
  readings: [reading("2026-10-15T10:30:00.000Z"), reading("2026-10-15T11:00:00.000Z")],
  mealTs: MEAL,
  previous: [],
  target: { low: 4, high: 10 },
  unit: "mmol",
  locale: "da",
  timeZone: "Europe/Copenhagen",
  size: "phone",
  now: new Date("2026-10-15T11:05:00.000Z"),
};

describe("pump markers on the meal curve (v0.7.0 plan §9)", () => {
  it("labels the meal's own bolus with its units at both widths", () => {
    for (const size of ["phone", "desktop"] as const) {
      const g = mealChartGeometry({
        ...meal,
        size,
        bolusTs: "2026-10-15T09:58:00.000Z",
        pumpBolusId: "lunch",
        pump: { boluses },
      });
      expect(g.bolus).toMatchObject({ clock: "11:58", units: 2.4, label: { text: "2,4 E" } });
      expect(g.bolus?.label?.y).toBe(size === "phone" ? 89 : 223);
    }
  });

  it("takes the units from the meal when the pump list has not arrived", () => {
    const g = mealChartGeometry({
      ...meal,
      bolusTs: "2026-10-15T09:58:00.000Z",
      pumpBolusId: "lunch",
      bolusUnits: 2.4,
    });
    expect(g.bolus).toMatchObject({ units: 2.4, label: { text: "2,4 E" } });
  });

  it("keeps a tapped bolus a bare time: no units, no label", () => {
    const g = mealChartGeometry({
      ...meal,
      bolusTs: "2026-10-15T09:58:00.000Z",
      pump: { boluses },
    });
    expect(g.bolus).toEqual({
      x: expect.any(Number) as number,
      path: expect.any(String) as string,
      clock: "11:58",
    });
  });

  it("draws the automatic and other boluses in its window as hollow markers, and no other meal's bolus", () => {
    const g = mealChartGeometry({
      ...meal,
      bolusTs: "2026-10-15T09:58:00.000Z",
      pumpBolusId: "lunch",
      pump: {
        boluses: [
          ...boluses,
          bolus("snack", "2026-10-15T12:30:00.000Z", 1, "standard", "m-snack"),
          bolus("auto2", "2026-10-15T11:30:00.000Z", 0.4, "automatic"),
        ],
      },
    });
    // −1 h/+4 h around 12:05 is 11:05 to 16:05: 13:00 (other) and 13:30 (automatic) are inside,
    // 07:10 (automatic) is not; the snack's standard bolus belongs to another meal.
    expect(g.pumpMarks.map((m) => [m.id, m.shape, m.clock])).toEqual([
      ["odd", "hollow", "13:00"],
      ["auto2", "hollow", "13:30"],
    ]);
    expect(mealChartMarkers({ mealTs: MEAL, pump: { boluses } })).toEqual({ autoBolus: true });
    expect(mealChartMarkers({ mealTs: MEAL, pump: { boluses: [auto] } })).toEqual({
      autoBolus: false,
    });
    expect(mealChartMarkers({ mealTs: MEAL })).toEqual({ autoBolus: false });
  });

  it("has no pump marks and no reach without pump props", () => {
    const g = mealChartGeometry(meal);
    expect(g.pumpMarks).toEqual([]);
    expect(g.reach).toBeNull();
    expect(
      mealChartGeometry({ ...meal, pump: { boluses: [], reach: "2026-10-15T10:40:00.000Z" } })
        .reach,
    ).toMatchObject({ clock: "12:40" });
  });
});

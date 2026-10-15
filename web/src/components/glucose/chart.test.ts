import type { Reading } from "@frejsi/shared";
import { describe, expect, it } from "vitest";

import { chartGeometry, type ChartInput } from "./chart";

const T0 = new Date("2026-10-14T13:13:00.000Z"); // 15:13 Copenhagen
const minutesAgo = (m: number) => new Date(T0.getTime() - m * 60_000).toISOString();
const reading = (ts: string, mmol: number): Reading => ({ ts, mmol, trend: "flat" });

const base: ChartInput = {
  readings: [],
  from: new Date(T0.getTime() - 3 * 60 * 60_000),
  to: T0,
  targetLow: 4,
  targetHigh: 10,
  unit: "mmol",
  timeZone: "Europe/Copenhagen",
  locale: "da",
  variant: "sparkline",
};

describe("chartGeometry (tokens.json#chart)", () => {
  it("draws the target band between the bounds with their labels right of the plot", () => {
    const g = chartGeometry(base);
    expect(g.width).toBe(326);
    expect(g.plotWidth).toBe(296);
    // Domain 2..14 over 120 px: 10 px per mmol; 10 → y 40, 4 → y 100 as the Main artboard draws.
    expect(g.band).toEqual({ top: 40, bottom: 100, highLabel: "10", lowLabel: "4", labelX: 304 });
    expect(g.segments).toEqual([]);
    expect(g.end).toBeNull();
  });

  it("labels the band in the space's unit", () => {
    const g = chartGeometry({ ...base, unit: "mgdl", locale: "en" });
    expect(g.band.highLabel).toBe("180");
    expect(g.band.lowLabel).toBe("72");
  });

  it("maps time to x across the plot and ends with a dot on the latest reading", () => {
    const g = chartGeometry({
      ...base,
      from: new Date(T0.getTime() - 30 * 60_000),
      readings: [reading(minutesAgo(30), 6), reading(minutesAgo(15), 8), reading(minutesAgo(0), 7)],
    });
    expect(g.segments).toEqual(["0,80 148,60 296,70"]);
    expect(g.end).toEqual({ x: 296, y: 70 });
  });

  it("breaks the curve where readings are more than 15 minutes apart (a sensor change)", () => {
    const g = chartGeometry({
      ...base,
      readings: [
        reading(minutesAgo(60), 6),
        reading(minutesAgo(55), 6.2),
        reading(minutesAgo(20), 7),
        reading(minutesAgo(15), 7.2),
      ],
    });
    expect(g.segments).toHaveLength(2);
    expect(g.segments[0]?.split(" ")).toHaveLength(2);
    expect(g.segments[1]?.split(" ")).toHaveLength(2);
  });

  it("widens the domain for a reading above the top and leaves readings outside the window out", () => {
    const g = chartGeometry({
      ...base,
      readings: [reading(minutesAgo(200), 5), reading(minutesAgo(10), 18.5)],
    });
    expect(g.segments).toHaveLength(1);
    expect(g.segments[0]?.split(" ")).toHaveLength(1);
    // Domain 2..19: 10 is lower on the plot than with the default 2..14 domain.
    expect(g.band.top).toBeGreaterThan(40);
    expect(g.end?.y).toBeGreaterThanOrEqual(0);
  });

  it("ticks every full hour on the sparkline and ends with now in bold", () => {
    const g = chartGeometry(base);
    // 15:00 is dropped next to 15:13, as the Main artboard draws it.
    expect(g.ticks.map((t) => t.label)).toEqual(["13:00", "14:00", "15:13"]);
    expect(g.ticks.at(-1)).toMatchObject({ x: 296, strong: true, anchor: "end" });
    expect(g.ticks[0]?.anchor).toBe("middle");
  });

  it("ticks every two hours from 06:00 on the day curve", () => {
    const g = chartGeometry({
      ...base,
      variant: "day",
      from: new Date("2026-10-14T04:00:00.000Z"),
    });
    expect(g.width).toBe(720);
    expect(g.ticks.map((t) => t.label)).toEqual([
      "06:00",
      "08:00",
      "10:00",
      "12:00",
      "14:00",
      "15:13",
    ]);
    // The 06:00 label sits on the left edge and is anchored there so it is not cut off.
    expect(g.ticks[0]).toMatchObject({ x: 0, anchor: "start" });
  });

  it("drops the hour tick that would collide with the now label", () => {
    const g = chartGeometry({ ...base, to: new Date("2026-10-14T13:40:00.000Z") });
    expect(g.ticks.map((t) => t.label)).toEqual(["13:00", "14:00", "15:00", "15:40"]);
  });
});

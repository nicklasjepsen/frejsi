import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Reading } from "../schemas/glucose";
import { Target, WeekNumbers } from "../schemas/history";
import { dayRange } from "../meals/day-range";
import {
  mealWindow,
  statsWindow,
  mealStats,
  bolusLeadMinutes,
  timeInRange,
  dishKey,
  sameDish,
  dayStats,
  lowEpisodes,
  weekStats,
  downsample,
  weekRange,
} from "./index";

const fixtureSchema = z.object({
  mealTs: z.iso.datetime().optional(),
  bolusTs: z.iso.datetime().optional(),
  timezone: z.string(),
  target: Target,
  readings: z.array(Reading),
});
const fixture = (name: string) =>
  fixtureSchema.parse(
    JSON.parse(
      readFileSync(new URL(`../../../fixtures/curves/${name}.json`, import.meta.url), "utf8"),
    ) as unknown,
  );
const typical = fixture("meal-typical");
const ts = "2026-10-14T10:00:00.000Z";
const at = (minutes: number) => new Date(Date.parse(ts) + minutes * 60000).toISOString();
const target = { low: 4, high: 10 };
const meal = { ts, bolusTs: at(-12) };
const r = (minutes: number, mmol = 6): Reading => ({ ts: at(minutes), mmol, trend: "flat" });
const completed = at(300);

describe("meal windows and statistics", () => {
  it("separates the context window from the three-hour statistics", () => {
    expect(mealWindow(ts)).toEqual({ from: new Date(at(-60)), to: new Date(at(240)) });
    expect(statsWindow(ts, at(80))).toEqual({
      from: new Date(ts),
      to: new Date(at(180)),
      complete: false,
    });
    expect(statsWindow(ts, at(180)).complete).toBe(true);
    const result = mealStats(
      typical.readings,
      { ts: typical.mealTs ?? "", bolusTs: typical.bolusTs },
      target,
      completed,
    );
    expect(result.peak).toEqual({ mmol: 9.6, ts: "2026-10-14T11:05:00Z", minutesAfterMeal: 65 });
    expect(result.inRange).toEqual({
      minutes: 180,
      coveredMinutes: 180,
      windowMinutes: 180,
      complete: true,
      belowMinutes: 0,
      aboveMinutes: 0,
    });
    expect(result.bolusLeadMinutes).toBe(12);
    expect(result.readingCount).toBe(37);
    const chart = mealWindow(ts);
    expect(
      typical.readings.filter((p) => new Date(p.ts) >= chart.from && new Date(p.ts) <= chart.to),
    ).toContainEqual(expect.objectContaining({ mmol: 15, ts: "2026-10-14T13:20:00Z" }));
  });
  it("handles absent, zero and negative timestamp differences", () => {
    expect(mealStats([], { ts }, target, completed)).not.toHaveProperty("bolusLeadMinutes");
    expect(mealStats([], { ts, bolusTs: null }, target, completed)).not.toHaveProperty("peak");
    expect(bolusLeadMinutes({ ts, bolusTs: ts })).toBe(0);
    expect(bolusLeadMinutes({ ts, bolusTs: at(5) })).toBe(-5);
    expect(bolusLeadMinutes({ ts, bolusTs: at(-12.6) })).toBe(13);
  });
  it("selects the earliest peak even with reversed input and duplicate timestamps", () => {
    expect(
      mealStats([r(10, 9), r(5, 9), r(5, 9), r(-5, 20), r(200, 30)], meal, target, completed),
    ).toMatchObject({ peak: { ts: at(5), mmol: 9, minutesAfterMeal: 5 }, readingCount: 2 });
  });
  it("leaves a thirty-minute gap entirely uncovered", () => {
    expect(mealStats(fixture("meal-gap").readings, meal, target, completed).inRange).toMatchObject({
      minutes: 150,
      coveredMinutes: 150,
      belowMinutes: 0,
      aboveMinutes: 0,
    });
  });
  it("clips an unfinished window to now and ignores future peaks", () => {
    const result = mealStats(fixture("meal-in-progress").readings, meal, target, at(80));
    expect(result.inRange).toMatchObject({
      complete: false,
      coveredMinutes: 80,
      windowMinutes: 180,
    });
    expect(result.peak?.mmol).toBe(9.6);
    expect(mealStats(typical.readings, meal, target, at(60)).peak?.minutesAfterMeal).toBe(60);
    expect(mealStats(typical.readings, meal, target, at(-5)).readingCount).toBe(0);
  });
  it("uses the same canonical readings for every display preference", () => {
    expect(mealStats(fixture("meal-mgdl-space").readings, meal, target, completed)).toEqual(
      mealStats(typical.readings, meal, target, completed),
    );
  });
});

describe("covered time", () => {
  const window = { from: ts, to: at(30) };
  it("counts no time without a successor and clips before the window", () => {
    expect(timeInRange([r(0)], window, target).coveredMinutes).toBe(0);
    expect(timeInRange([r(-5), r(5)], window, target).minutes).toBe(5);
    expect(timeInRange([r(-20), r(5)], window, target).minutes).toBe(0);
  });
  it("includes both bounds and accounts for below, above and the final clipped interval", () => {
    expect(
      timeInRange(
        [r(35), r(20, 11), r(10, 10), r(0, 4), r(-5, 3)],
        { from: at(-2), to: at(30) },
        target,
      ),
    ).toEqual({
      minutes: 20,
      coveredMinutes: 32,
      belowMinutes: 2,
      aboveMinutes: 10,
      windowMinutes: 32,
      complete: true,
    });
  });
  it("clips to now without counting a future value", () => {
    expect(timeInRange([r(0), r(10, 20)], window, target, at(7))).toMatchObject({
      minutes: 7,
      coveredMinutes: 7,
      aboveMinutes: 0,
      complete: false,
    });
  });
});

describe("same dish", () => {
  const a = [
    { foodId: "f1", name: "Æble", grams: 100 },
    { foodId: "f2", name: "Bread", grams: 40 },
  ];
  it("ignores order, portions, duplicate items and a deleted food reference", () => {
    const b = [
      { name: "bread", grams: 90 },
      { name: "æble", grams: 50 },
    ];
    expect(dishKey(a)).toBe(dishKey(b));
    expect(dishKey([...a].reverse())).toBe(dishKey(a));
    expect(dishKey([...a, ...a])).toBe(dishKey(a));
    expect(sameDish(a, b)).toBe(dishKey(a) === dishKey(b));
    expect(sameDish(a, [...a, { name: "Cheese" }])).toBe(false);
  });
  it("does not confuse newlines in a food name with separate foods", () => {
    expect(dishKey([{ name: "a\nname:b" }])).not.toBe(dishKey([{ name: "a" }, { name: "b" }]));
  });
});

describe("day and week aggregation", () => {
  it("computes a covered day and two night episodes from the fixture", () => {
    const f = fixture("day-with-night-lows");
    const [from, to] = dayRange("2026-10-14", f.timezone);
    const firstMeal = { id: "m1", ts, totalCarbs: 40 };
    const meals = [firstMeal];
    expect(dayStats(f.readings, meals, target, { from, to }, to)).toEqual({
      inRange: {
        minutes: 1400,
        coveredMinutes: 1440,
        windowMinutes: 1440,
        complete: true,
        belowMinutes: 40,
        aboveMinutes: 0,
      },
      meals: [{ mealId: "m1", stats: mealStats(f.readings, firstMeal, target, to) }],
      totalCarbs: 40,
      mealCount: 1,
    });
    expect(lowEpisodes(f.readings, target, f.timezone)).toEqual({ count: 2, atNight: 2 });
  });
  it.each([
    [20, 1],
    [40, 2],
  ])("requires thirty minutes of recovery (%i minutes)", (recovery, count) => {
    const readings = [
      r(0, 3),
      ...Array.from({ length: recovery / 5 }, (_, i) => r(5 + i * 5)),
      r(recovery + 5, 3),
    ];
    expect(lowEpisodes(readings, target, "Europe/Copenhagen")).toEqual({ count, atNight: 0 });
  });
  it("does not treat an unobserved gap as recovery", () => {
    expect(lowEpisodes([r(0, 3), r(5), r(60, 3)], target, "Europe/Copenhagen").count).toBe(1);
  });
  it("keeps completed recovery after a later sensor gap", () => {
    const readings = [r(0, 3), ...Array.from({ length: 7 }, (_, i) => r(5 + i * 5)), r(100, 3)];
    expect(lowEpisodes(readings, target, "Europe/Copenhagen").count).toBe(2);
  });
  it("uses the local hour for night episodes", () => {
    expect(lowEpisodes([r(0, 3)], target, "Europe/Copenhagen").atNight).toBe(0);
    expect(lowEpisodes([r(0, 3)], target, "Pacific/Honolulu").atNight).toBe(1);
  });
  it("keeps a late meal's full statistics while excluding it from the next day", () => {
    const readings = [r(0), r(5), r(10, 12), r(15)];
    const meals = [
      { id: "late", ts, totalCarbs: 40 },
      { id: "next", ts: at(5), totalCarbs: 90 },
    ];
    const result = dayStats(readings, meals, target, { from: at(-60), to: at(5) }, completed);
    expect(result.mealCount).toBe(1);
    expect(result.meals[0]?.stats.peak?.mmol).toBe(12);
    expect(result.inRange.aboveMinutes).toBe(0);
  });
  it("computes a deterministic week and previous week with only registered taps in the mean", () => {
    const from = at(0),
      to = at(7 * 1440);
    const readings = Array.from({ length: 7 * 288 + 1 }, (_, i) => r(i * 5, i % 4 === 0 ? 3 : 6));
    const previousWeekReadings = Array.from({ length: 7 * 288 + 1 }, (_, i) => r(i * 5 - 7 * 1440));
    const meals = Array.from({ length: 23 }, (_, i) => ({
      id: `m${i}`,
      ts: at(i * 60),
      totalCarbs: 40,
      ...(i < 17 ? { bolusTs: at(i * 60 - 9) } : {}),
    }));
    const result = weekStats({
      readings,
      previousWeekReadings,
      meals,
      target,
      weekRange: { from, to },
      timezone: "Europe/Copenhagen",
      now: to,
    });
    expect(result).toMatchObject({
      inRangePercent: 75,
      previousWeekInRangePercent: 100,
      belowPercent: 25,
      carbsPerDay: 131,
      mealCount: 23,
      bolusLead: { meanMinutes: 9, registered: 17, of: 23 },
    });
    expect(WeekNumbers.safeParse(result).success).toBe(true);
    const empty = weekStats({
      readings: [],
      previousWeekReadings: [],
      meals: [],
      target,
      weekRange: { from, to },
      timezone: "Europe/Copenhagen",
      now: to,
    });
    expect(empty).not.toHaveProperty("inRangePercent");
    expect(empty).not.toHaveProperty("belowPercent");
    expect(empty).not.toHaveProperty("previousWeekInRangePercent");
    expect(empty.bolusLead).not.toHaveProperty("meanMinutes");
  });
  it("averages thirty-minute buckets relative to a passed day start", () => {
    const readings = Array.from({ length: 288 }, (_, i) => r(i * 5, i % 2 ? 8 : 6));
    const sampled = downsample(readings, 30, ts);
    expect(sampled).toHaveLength(48);
    expect(sampled[0]).toEqual({ ts, mmol: 7 });
    expect(downsample([], 30)).toEqual([]);
    expect(() => downsample(readings, 0)).toThrow();
  });
  it("keeps a long DST day within the tile contract without dropping readings", () => {
    const [from] = dayRange("2026-10-25", "Europe/Copenhagen");
    const readings = Array.from({ length: 300 }, (_, i) => ({
      ts: new Date(from.getTime() + i * 300000).toISOString(),
      mmol: i % 2 ? 8 : 6,
      trend: "flat" as const,
    }));
    const sampled = downsample(readings, 30, from);
    expect(sampled.length).toBeLessThanOrEqual(48);
    expect(sampled.at(-1)?.ts).toBe(new Date(from.getTime() + 24 * 3600000).toISOString());
    expect(sampled.every((point) => point.mmol === 7)).toBe(true);
  });
  it("finds the ISO week in the requested timezone, including DST and year boundaries", () => {
    expect(weekRange("2026-10-14", "Europe/Copenhagen")).toMatchObject({
      weekStart: "2026-10-12",
      weekEnd: "2026-10-19",
      isoWeek: 42,
      isoYear: 2026,
      from: new Date("2026-10-11T22:00:00Z"),
    });
    expect(weekRange("2026-10-14", "America/New_York").from).toEqual(
      new Date("2026-10-12T04:00:00Z"),
    );
    const dst = weekRange("2026-10-25", "Europe/Copenhagen");
    expect((dst.to.getTime() - dst.from.getTime()) / 3600000).toBe(169);
    expect(weekRange("2027-01-01", "Europe/Copenhagen")).toMatchObject({
      weekStart: "2026-12-28",
      isoYear: 2026,
      isoWeek: 53,
    });
  });
});

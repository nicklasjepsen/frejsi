// @vitest-environment node
import { describe, expect, it } from "vitest";
import { dayStats, mealStats, weekStats, weekRange } from "@frejsi/shared";
import { MemoryHistoryRepository } from "./memory";
import { loadMealCurve } from "./meal-curve";
import { loadHistoryDay } from "./day";
import { loadHistoryWeek } from "./week";
import type { HistoryMeal } from "./types";
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing test value");
  return value;
}
const now = new Date("2026-10-19T06:00:00Z");
const target = { low: 4, high: 10 };
function setup() {
  const repo = new MemoryHistoryRepository();
  repo.spaces.set("s1", { timezone: "Europe/Copenhagen", target });
  repo.spaces.set("s2", { timezone: "Europe/Copenhagen", target });
  const meal: HistoryMeal = {
    id: "meal-private",
    spaceId: "s1",
    ts: "2026-10-18T21:30:00.000Z",
    totalCarbs: 40,
    byUser: { id: "u1", name: "Fictional member" },
    note: "private-note",
    photoKey: "photo",
    items: [
      {
        name: "Test dish",
        carbs: 40,
        grams: 100,
        foodId: "f1",
        food: { portions: [{ label: "slice", grams: 50, carbs: 20 }], carbsPer100g: 40 },
      },
    ],
    bolusTs: "2026-10-18T21:20:00.000Z",
  };
  repo.meals.push(meal);
  for (let i = -65; i <= 245; i += 5)
    repo.readings.push({
      spaceId: "s1",
      ts: new Date(Date.parse(meal.ts) + i * 60000).toISOString(),
      mmol: i === 65 ? 9.6 : 6,
      trend: "flat",
    });
  const deps = { repo, now: () => now, photos: null };
  return { repo, meal, deps };
}
describe("history read services", () => {
  it("returns the inclusive ordered chart, shared stats, current edit data, photo and scoped neighbours", async () => {
    const { repo, meal, deps } = setup();
    repo.meals.push(
      { ...meal, id: "later", ts: "2026-10-19T05:00:00Z" },
      { ...meal, id: "foreign", spaceId: "s2" },
    );
    const photos = {
      readUrl: (key: string, size: string) =>
        Promise.resolve(`https://photos.invalid/${key}/${size}`),
      put: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    };
    const view = await loadMealCurve("s1", meal.id, "en", { ...deps, photos });
    expect(view.readings).toHaveLength(61);
    expect(view.readings[0]?.ts).toBe("2026-10-18T20:30:00.000Z");
    expect(view.readings.at(-1)?.ts).toBe("2026-10-19T01:30:00.000Z");
    expect(view.stats).toEqual(mealStats(view.readings, meal, target, now));
    expect(view.stats.peak).toEqual({
      mmol: 9.6,
      ts: "2026-10-18T22:35:00.000Z",
      minutesAfterMeal: 65,
    });
    expect(view.editItems[0]).toMatchObject({
      foodId: "f1",
      portions: [{ label: "slice", grams: 50, carbs: 20 }],
      carbsPer100g: 40,
    });
    expect(view.meal.photo?.thumbUrl).toBe("https://photos.invalid/photo/thumb");
    expect(view.neighbours).toEqual({ nextMealId: "later" });
    expect(view.now).toBe(now.toISOString());
    await expect(loadMealCurve("s2", meal.id, "en", deps)).rejects.toMatchObject({ status: 404 });
  });
  it("selects five newest matching occurrences, ignores portions, extra foods and other spaces, and uses bounded fallback for deleted foods", async () => {
    const { repo, meal, deps } = setup();
    for (let i = 1; i <= 7; i++)
      repo.meals.push({
        ...meal,
        id: `earlier-${i}`,
        ts: new Date(Date.parse(meal.ts) - i * 86400000).toISOString(),
        items: [{ ...required(meal.items[0]), grams: i * 10 }],
      });
    repo.meals.push(
      {
        ...meal,
        id: "extra",
        ts: "2026-10-18T20:00:00Z",
        items: [...meal.items, { name: "Extra", carbs: 2 }],
      },
      { ...meal, id: "foreign", spaceId: "s2", ts: "2026-10-18T20:00:00Z" },
    );
    const view = await loadMealCurve("s1", meal.id, "en", deps);
    expect(view.previous.map((m) => m.mealId)).toEqual([1, 2, 3, 4, 5].map((i) => `earlier-${i}`));
    expect(repo.calls.filter((c) => c.method === "readingsBetween")).toHaveLength(6);
    expect(repo.calls.some((c) => c.method === "candidateMeals")).toBe(true);
    meal.items = [{ name: "TEST DISH", carbs: 20 }];
    repo.calls.length = 0;
    const fallback = await loadMealCurve("s1", meal.id, "en", deps);
    expect(fallback.previous).toHaveLength(5);
    expect(fallback.editItems[0]).toEqual({ name: "TEST DISH", carbs: 20 });
    expect(repo.calls.find((c) => c.method === "recentMeals")?.args.at(-1)).toBe(200);
  });
  it("keeps late-meal stats identical across curve, day and week with one/two range queries", async () => {
    const { repo, meal, deps } = setup();
    const curve = await loadMealCurve("s1", meal.id, "en", deps);
    repo.calls.length = 0;
    const day = await loadHistoryDay("s1", "2026-10-18", true, "en", deps);
    expect(day.meals[0]?.stats).toEqual(curve.stats);
    expect(day.to).toBe("2026-10-18T22:00:00.000Z");
    expect(day.readings.every((r) => r.ts <= day.to)).toBe(true);
    expect(day.meals[0]?.bolusTs).toBe(meal.bolusTs);
    expect(repo.calls.filter((c) => c.method === "readingsBetween")).toHaveLength(1);
    expect(day.inRange).toEqual(
      dayStats(repo.readings, [meal], target, { from: day.from, to: day.to }, now).inRange,
    );
    repo.calls.length = 0;
    const week = await loadHistoryWeek("s1", "2026-10-12", "en", deps);
    expect(week.meals[0]?.stats).toEqual(curve.stats);
    expect(week.days).toHaveLength(7);
    expect(week.days.every((d) => d.curve.length <= 48)).toBe(true);
    expect(week.days[6]?.mealTimes).toEqual([meal.ts]);
    expect(week.numbers).toEqual(
      weekStats({
        readings: repo.readings,
        previousWeekReadings: [],
        meals: [meal],
        target,
        weekRange: weekRange("2026-10-12", "Europe/Copenhagen"),
        timezone: "Europe/Copenhagen",
        now,
      }),
    );
    expect(repo.calls.filter((c) => c.method === "readingsBetween")).toHaveLength(2);
    expect((await loadHistoryDay("s1", "2026-10-18", false, "en", deps)).readings).toEqual([]);
  });
  it("carries the stored symbol on the curve, the day and the week, unknown for a row without one", async () => {
    const { repo, meal, deps } = setup();
    meal.symbol = "starch";
    const older = { ...meal, id: "older", ts: "2026-10-18T12:00:00.000Z", symbol: undefined };
    repo.meals.push(older);
    expect((await loadMealCurve("s1", meal.id, "en", deps)).meal.symbol).toBe("starch");
    expect((await loadMealCurve("s1", older.id, "en", deps)).meal.symbol).toBe("unknown");
    const day = await loadHistoryDay("s1", "2026-10-18", true, "en", deps);
    expect(day.meals.map((m) => [m.id, m.symbol])).toEqual([
      [meal.id, "starch"],
      [older.id, "unknown"],
    ]);
    const week = await loadHistoryWeek("s1", "2026-10-12", "en", deps);
    expect(week.days[6]?.meals).toEqual([
      { ts: meal.ts, symbol: "starch" },
      { ts: older.ts, symbol: "unknown" },
    ]);
    expect(week.days[6]?.mealTimes).toEqual([meal.ts, older.ts]);
    expect(week.days[0]?.meals).toEqual([]);
  });
  it("navigates every meal when timestamps are identical, using IDs as the tie break", async () => {
    const { repo, meal, deps } = setup();
    repo.meals.push(
      { ...meal, id: "a-before" },
      { ...meal, id: "z-after" },
      { ...meal, id: "b-foreign", spaceId: "s2" },
    );
    expect((await loadMealCurve("s1", meal.id, "en", deps)).neighbours).toEqual({
      previousMealId: "a-before",
      nextMealId: "z-after",
    });
    expect((await loadMealCurve("s1", "a-before", "en", deps)).neighbours).toEqual({
      nextMealId: meal.id,
    });
    expect((await loadMealCurve("s1", "z-after", "en", deps)).neighbours).toEqual({
      previousMealId: meal.id,
    });
  });
  it("includes name matches even when the current meal has food references", async () => {
    const { repo, meal, deps } = setup();
    repo.meals.push({
      ...meal,
      id: "manual",
      ts: "2026-10-17T12:00:00.000Z",
      items: [{ name: "TEST DISH", carbs: 20 }],
    });
    expect((await loadMealCurve("s1", meal.id, "en", deps)).previous.map((m) => m.mealId)).toEqual([
      "manual",
    ]);
  });
  it("preserves predecessor and successor coverage at day and ISO-week boundaries", async () => {
    for (const ts of ["2026-10-12T00:01:00.000Z", "2026-10-18T23:59:00.000Z"]) {
      const { repo, meal, deps } = setup();
      repo.spaces.set("s1", { timezone: "UTC", target });
      meal.ts = ts;
      repo.readings.length = 0;
      for (let i = -3; i <= 242; i += 5)
        repo.readings.push({
          spaceId: "s1",
          ts: new Date(Date.parse(ts) + i * 60000).toISOString(),
          mmol: 6,
          trend: "flat",
        });
      const curve = await loadMealCurve("s1", meal.id, "en", deps);
      const day = await loadHistoryDay("s1", ts.slice(0, 10), true, "en", deps);
      const week = await loadHistoryWeek("s1", "2026-10-12", "en", deps);
      expect(curve.stats.inRange.coveredMinutes).toBe(180);
      expect(day.meals[0]?.stats).toEqual(curve.stats);
      expect(week.meals[0]?.stats).toEqual(curve.stats);
      expect(day.readings.every((r) => r.ts >= day.from && r.ts <= day.to)).toBe(true);
    }
  });
  it("uses local today/current ISO week, reports older data, handles DST and rejects non-Mondays", async () => {
    const { repo, deps } = setup();
    const day = await loadHistoryDay("s1", null, true, "en", deps);
    expect(day.date).toBe("2026-10-19");
    expect(day.hasOlder).toBe(true);
    expect((await loadHistoryWeek("s1", null, "en", deps)).weekStart).toBe("2026-10-19");
    const dst = await loadHistoryDay("s1", "2026-10-25", true, "en", deps);
    expect(Date.parse(dst.to) - Date.parse(dst.from)).toBe(25 * 3600000);
    await expect(loadHistoryWeek("s1", "2026-10-13", "en", deps)).rejects.toMatchObject({
      status: 400,
    });
    repo.meals.length = 0;
    repo.readings.length = 0;
    expect((await loadHistoryWeek("s1", null, "en", deps)).numbers.inRangePercent).toBeUndefined();
  });
});

describe("the pump record in the history views (v0.7.0 plan §4)", () => {
  function pumpSetup() {
    const base = setup();
    // The person's meal took the 21:20 bolus; a pump meal at 18:00 came from an unmatched one.
    Object.assign(base.meal, {
      pumpBolusId: "b-dinner",
      pumpBolus: { units: 2.4, carbs: 45 },
    });
    const pumpMeal: HistoryMeal = {
      id: "pump-meal",
      spaceId: "s1",
      ts: "2026-10-18T16:00:00.000Z",
      totalCarbs: 30,
      byUser: { id: "u1", name: "Fictional member" },
      items: [{ name: "Carbs from the pump", carbs: 30 }],
      bolusTs: "2026-10-18T16:00:00.000Z",
      source: "pump",
      pumpBolusId: "b-snack",
      pumpBolus: { units: 1.5, carbs: 30 },
    };
    base.repo.meals.push(pumpMeal);
    return { ...base, pumpMeal };
  }
  it("carries pumpBolusId and fromPump on the day's meals, and no units or pump carbs", async () => {
    const { deps, meal, pumpMeal } = pumpSetup();
    const day = await loadHistoryDay("s1", "2026-10-18", false, "en", deps);
    const byId = new Map(day.meals.map((m) => [m.id, m]));
    expect(byId.get(meal.id)).toMatchObject({ pumpBolusId: "b-dinner", bolusTs: meal.bolusTs });
    expect(byId.get(meal.id)).not.toHaveProperty("fromPump");
    expect(byId.get(pumpMeal.id)).toMatchObject({ pumpBolusId: "b-snack", fromPump: true });
    expect(byId.get(pumpMeal.id)?.stats).not.toHaveProperty("bolusLeadMinutes");
    expect(JSON.stringify(day)).not.toMatch(/bolusUnits|pumpCarbs|"source"/);
  });
  it("carries the bolus's units and carbs on the meal curve, and no lead for a pump meal", async () => {
    const { deps, meal, pumpMeal } = pumpSetup();
    const curve = await loadMealCurve("s1", meal.id, "en", deps);
    expect(curve.meal).toMatchObject({
      pumpBolusId: "b-dinner",
      bolusUnits: 2.4,
      pumpCarbs: 45,
      bolusTs: meal.bolusTs,
    });
    expect(curve.meal).not.toHaveProperty("fromPump");
    expect(curve.stats.bolusLeadMinutes).toBe(10);
    const pump = await loadMealCurve("s1", pumpMeal.id, "en", deps);
    expect(pump.meal).toMatchObject({ fromPump: true, pumpBolusId: "b-snack", bolusUnits: 1.5 });
    expect(pump.stats).not.toHaveProperty("bolusLeadMinutes");
  });
  it("names the pump as the logger of an untouched pump meal on the day and the curve (#244)", async () => {
    const { deps, meal, pumpMeal } = pumpSetup();
    const day = await loadHistoryDay("s1", "2026-10-18", false, "da", deps);
    const byId = new Map(day.meals.map((m) => [m.id, m]));
    expect(byId.get(pumpMeal.id)?.byUser).toEqual({ id: "pump", name: "Pumpen" });
    expect(byId.get(meal.id)?.byUser).toEqual(meal.byUser);
    const curve = await loadMealCurve("s1", pumpMeal.id, "en", deps);
    expect(curve.meal.byUser).toEqual({ id: "pump", name: "the pump" });
    expect(JSON.stringify([byId.get(pumpMeal.id), curve.meal])).not.toContain("Fictional member");
  });
  it("never offers an untouched pump meal as an earlier occurrence of the same dish", async () => {
    const { repo, deps, pumpMeal } = pumpSetup();
    repo.meals.push(
      { ...pumpMeal, id: "pump-earlier", ts: "2026-10-17T16:00:00.000Z" },
      { ...pumpMeal, id: "adopted-earlier", ts: "2026-10-16T16:00:00.000Z", source: null },
    );
    const curve = await loadMealCurve("s1", pumpMeal.id, "en", deps);
    expect(curve.previous.map((p) => p.mealId)).toEqual(["adopted-earlier"]);
  });
  it("leaves pump meals out of the week's lead figures", async () => {
    const { deps } = pumpSetup();
    const week = await loadHistoryWeek("s1", "2026-10-12", "en", deps);
    // Neither side of "registered 1 of 1" counts the untouched pump meal; the meal count does.
    expect(week.numbers.bolusLead).toEqual({ registered: 1, of: 1, meanMinutes: 10 });
    expect(week.numbers.mealCount).toBe(2);
    expect(week.meals.find((m) => m.mealId === "pump-meal")).not.toHaveProperty("bolusLeadMinutes");
  });
});

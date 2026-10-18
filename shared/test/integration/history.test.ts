import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it } from "vitest";

import { createEmptyDatabase, migrate, type ScratchDatabase } from "./database";
import { PrismaHistoryRepository } from "../../../web/src/lib/history/prisma";
import { previousOccurrences } from "../../../web/src/lib/history/previous-occurrences";
import type { DayHistoryView, WeekHistoryView } from "../../src/schemas/history";
import type { DayView } from "../../src/schemas/meal";
const WEEK = "@/lib/history/week";
const HISTORY_DAY = "@/lib/history/day";
const DAY = "@/app/api/spaces/[spaceId]/day/load-day";
/**
 * Every pump field name of v0.7.0 and the column that marks a pump meal: none reaches a viewer.
 * (`carbs` is every item line's own key; the pump meal's carbs show up in the day's total instead.)
 */
const PUMP_KEYS = [
  "source",
  "pumpBolusId",
  "fromPump",
  "bolusUnits",
  "pumpCarbs",
  "units",
];

let scratch: ScratchDatabase;
let db: PrismaClient<{ log: [{ emit: "event"; level: "query" }] }>;
let spaceId: string;
let userId: string;
let otherSpaceId: string;
let foodId: string;
const queries: string[] = [];
const at = (day: number, minute = 0) => new Date(Date.UTC(2026, 9, day, 12, minute));

beforeAll(async () => {
  scratch = await createEmptyDatabase("frejsi_history_it");
  migrate(scratch.url);
  db = new PrismaClient({ datasourceUrl: scratch.url, log: [{ emit: "event", level: "query" }] });
  db.$on("query", (event) => {
    queries.push(event.query);
  });
  // Fictional SQL fixtures; these never enter the application or contact a source.
  const user = await db.user.create({ data: { name: "History fixture" } });
  userId = user.id;
  const space = await db.space.create({
    data: { name: "History fixture space", timezone: "Europe/Copenhagen" },
  });
  spaceId = space.id;
  otherSpaceId = (
    await db.space.create({ data: { name: "Other fixture space", timezone: "Europe/Copenhagen" } })
  ).id;
  foodId = (
    await db.food.create({
      data: {
        spaceId,
        name: "Fictional dish",
        nameSearch: "fictional dish",
        portions: "[]",
        origin: "family",
        sourceRef: crypto.randomUUID(),
        verified: false,
        createdBy: userId,
      },
    })
  ).id;
});
afterAll(async () => {
  await db.$disconnect();
  await scratch.drop();
});

it("returns exactly the inclusive reading window, ordered and scoped to the space", async () => {
  for (const minute of [11, -1, 10, 0, 5]) {
    await db.reading.create({
      data: { spaceId, ts: at(15, minute), mmol: 7, trend: "flat", source: "fake" },
    });
  }
  await db.reading.create({
    data: { spaceId: otherSpaceId, ts: at(15, 5), mmol: 8, trend: "flat", source: "fake" },
  });
  const rows = await new PrismaHistoryRepository(db).readingsBetween(spaceId, at(15), at(15, 10));
  expect(rows).toEqual(
    [0, 5, 10].map((minute) => ({ ts: at(15, minute).toISOString(), mmol: 7, trend: "flat" })),
  );
});

it("matches different portions and deleted-food snapshots, excluding extra items and other spaces", async () => {
  async function meal(
    day: number,
    carbs: number,
    options: { extra?: boolean; other?: boolean } = {},
  ) {
    return db.meal.create({
      data: {
        spaceId: options.other ? otherSpaceId : spaceId,
        byUserId: userId,
        ts: at(day),
        totalCarbs: carbs,
        items: {
          create: [
            {
              position: 0,
              foodId,
              name: "Fictional dish",
              grams: carbs * 2,
              carbs,
            },
            ...(options.extra ? [{ position: 1, name: "Extra fictional item", carbs: 3 }] : []),
          ],
        },
      },
    });
  }
  const earlier = await Promise.all([meal(10, 20), meal(11, 30), meal(12, 40)]);
  const deletedFood = await db.food.create({
    data: {
      spaceId,
      name: "Fictional dish",
      nameSearch: "fictional dish",
      portions: "[]",
      origin: "family",
      sourceRef: crypto.randomUUID(),
      verified: false,
      createdBy: userId,
    },
  });
  const deleted = await db.meal.create({
    data: {
      spaceId,
      byUserId: userId,
      ts: at(13),
      totalCarbs: 25,
      items: { create: { position: 0, foodId: deletedFood.id, name: "Fictional dish", carbs: 25 } },
    },
  });
  await db.food.delete({ where: { id: deletedFood.id } });
  await meal(14, 35, { extra: true });
  await meal(14, 35, { other: true });
  const current = await meal(15, 50);
  const repo = new PrismaHistoryRepository(db);
  const loaded = await repo.mealById(spaceId, current.id);
  expect(loaded).not.toBeNull();
  if (!loaded) throw new Error("Missing current meal");
  const matches = await previousOccurrences(loaded, repo);
  expect(matches.map((row) => row.id)).toEqual([
    deleted.id,
    ...earlier.reverse().map((row) => row.id),
  ]);
  expect(matches[0]?.items[0]?.foodId).toBeUndefined();
  expect(matches.map((row) => row.totalCarbs)).toEqual([25, 40, 30, 20]);
  expect(await repo.mealById(otherSpaceId, current.id)).toBeNull();
  // The symbol column (0005): read back as stored, the apple for a row written without one.
  expect(loaded.symbol).toBe("unknown");
  const withSymbol = await db.meal.create({
    data: {
      spaceId,
      byUserId: userId,
      ts: at(16),
      totalCarbs: 24,
      symbol: "bread",
      items: { create: { position: 0, name: "Fictional loaf", carbs: 24 } },
    },
  });
  expect((await repo.mealById(spaceId, withSymbol.id))?.symbol).toBe("bread");
});

it("loads week statistics with exactly two SQL reading queries", async () => {
  queries.length = 0;
  const { loadHistoryWeek } = (await import(WEEK)) as {
    loadHistoryWeek: (
      spaceId: string,
      start: string,
      locale: string,
      deps: object,
    ) => Promise<WeekHistoryView>;
  };
  const week = await loadHistoryWeek(spaceId, "2026-10-12", "en", {
    repo: new PrismaHistoryRepository(db),
    photos: null,
    now: () => at(19),
  });
  expect(week.days).toHaveLength(7);
  expect(week.numbers.mealCount).toBe(5);
  expect(week.days.find((day) => day.date === "2026-10-15")?.curve.length).toBeGreaterThan(0);
  expect(week.days.find((day) => day.date === "2026-10-15")?.meals).toEqual([
    { ts: at(15).toISOString(), symbol: "unknown" },
  ]);
  expect(week.days.find((day) => day.date === "2026-10-16")?.meals).toEqual([
    { ts: at(16).toISOString(), symbol: "bread" },
  ]);
  expect(queries.filter((query) => /FROM\s+\[dbo\]\.\[Reading\]/i.test(query))).toHaveLength(2);
});

/** Every key of a JSON value, at any depth. */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([key, child]) => [key, ...keysOf(child)]);
  return [];
}

it("keeps untouched pump meals and every pump field out of the viewer's and the simpleMode day (v0.7.0)", async () => {
  const day = "2026-10-20";
  const bolus = await db.pumpBolus.create({
    data: { spaceId, sourceId: "ns-it-1", ts: at(20, -5), units: 2.4, kind: "standard", carbs: 45 },
  });
  const pumpBolus = await db.pumpBolus.create({
    data: {
      spaceId,
      sourceId: "ns-it-2",
      ts: at(20, 240),
      units: 1.5,
      kind: "standard",
      carbs: 30,
    },
  });
  const linked = await db.meal.create({
    data: {
      spaceId,
      byUserId: userId,
      ts: at(20),
      totalCarbs: 40,
      pumpBolusId: bolus.id,
      bolusTs: at(20, -5),
      items: { create: { position: 0, name: "Fictional lunch", carbs: 40 } },
    },
  });
  const pumpMeal = await db.meal.create({
    data: {
      spaceId,
      byUserId: userId,
      ts: at(20, 240),
      totalCarbs: 30,
      source: "pump",
      pumpBolusId: pumpBolus.id,
      bolusTs: at(20, 240),
      items: { create: { position: 0, name: "Carbs from the pump", carbs: 30 } },
    },
  });
  const { loadDay } = (await import(DAY)) as {
    loadDay: (
      spaceId: string,
      date: string,
      locale: "en",
      deps: object,
      options?: { pumpMeals: boolean },
    ) => Promise<DayView>;
  };
  const deps = { db, photos: null, now: () => at(21) };
  // The viewer's day and a simpleMode day are the same query: `pumpMeals: false`.
  for (const restricted of [
    await loadDay(spaceId, day, "en", deps),
    await loadDay(spaceId, day, "en", deps, { pumpMeals: false }),
  ]) {
    expect(restricted.meals.map((meal) => meal.id)).toEqual([linked.id]);
    expect(restricted.totalCarbs).toBe(40);
    for (const key of keysOf(restricted)) expect(PUMP_KEYS, key).not.toContain(key);
    expect(JSON.stringify(restricted)).not.toMatch(/bolus|pump/i);
  }
  const full = await loadDay(spaceId, day, "en", deps, { pumpMeals: true });
  expect(full.meals.map((meal) => meal.id)).toEqual([pumpMeal.id, linked.id]);
  for (const key of keysOf(full)) expect(PUMP_KEYS, key).not.toContain(key);

  // An owner's history day carries the link and the pump-meal mark, read through Prisma.
  const { loadHistoryDay } = (await import(HISTORY_DAY)) as {
    loadHistoryDay: (
      spaceId: string,
      date: string,
      readings: boolean,
      locale: string,
      deps: object,
    ) => Promise<DayHistoryView>;
  };
  const history = await loadHistoryDay(spaceId, day, false, "en", {
    repo: new PrismaHistoryRepository(db),
    photos: null,
    now: () => at(21),
  });
  const byId = new Map(history.meals.map((meal) => [meal.id, meal]));
  expect(byId.get(linked.id)).toMatchObject({ pumpBolusId: bolus.id });
  expect(byId.get(pumpMeal.id)).toMatchObject({ pumpBolusId: pumpBolus.id, fromPump: true });
  const detail = await new PrismaHistoryRepository(db).mealById(spaceId, linked.id);
  expect(detail?.pumpBolus).toEqual({ units: 2.4, carbs: 45 });
});

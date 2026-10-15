import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it } from "vitest";

import { createEmptyDatabase, migrate, type ScratchDatabase } from "./database";
import { PrismaHistoryRepository } from "../../../web/src/lib/history/prisma";
import { previousOccurrences } from "../../../web/src/lib/history/previous-occurrences";
import type { WeekHistoryView } from "../../src/schemas/history";
const WEEK = "@/lib/history/week";

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
  expect(week.numbers.mealCount).toBe(4);
  expect(week.days.find((day) => day.date === "2026-10-15")?.curve.length).toBeGreaterThan(0);
  expect(queries.filter((query) => /FROM\s+\[dbo\]\.\[Reading\]/i.test(query))).toHaveLength(2);
});

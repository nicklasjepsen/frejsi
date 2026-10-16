import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { createEmptyDatabase, migrate, type ScratchDatabase } from "./database";

const SEED = new URL("../../../web/scripts/seed.ts", import.meta.url).pathname;
let scratch: ScratchDatabase;
let db: PrismaClient;
beforeAll(async () => {
  vi.stubEnv("APP_ORIGIN", "http://localhost:3100");
  scratch = await createEmptyDatabase("frejsi_seed_it");
  migrate(scratch.url);
  db = new PrismaClient({ datasourceUrl: scratch.url });
});
afterAll(async () => {
  await db.$disconnect();
  await scratch.drop();
  vi.unstubAllEnvs();
});

it("seeds ten foods, fourteen reading days and seven meals through the emitting services", async () => {
  const { seed } = (await import(SEED)) as {
    seed: (options: { db: PrismaClient; now: () => Date }) => Promise<{ spaceId: string }>;
  };
  const { spaceId } = await seed({ db, now: () => new Date("2026-10-15T13:00:00Z") });
  const foods = await db.food.findMany({ where: { spaceId } });
  expect(foods).toHaveLength(10);
  expect(await db.space.findUniqueOrThrow({ where: { id: spaceId } })).toMatchObject({
    aiEnabled: true,
    aiProvider: "anthropic",
  });
  const asked = foods.find((food) => food.origin === "ai");
  if (!asked?.createdBy) throw new Error("missing asked food creator");
  expect(asked).toMatchObject({ name: "Pasta med kødsovs", verified: false });
  expect((await db.user.findUniqueOrThrow({ where: { id: asked.createdBy } })).name).toBe("Alma");
  const insight = await db.insight.findFirstOrThrow({ where: { spaceId, kind: "meal" } });
  expect(insight.text).toBe("Toppen kom omkring en time efter måltidet.");
  expect(await db.event.count({ where: { spaceId, type: "insight.created" } })).toBe(1);
  const askedEvents = await db.event.findMany({ where: { spaceId, type: "estimate.asked" } });
  expect(askedEvents).toHaveLength(1);
  const askedEvent = askedEvents[0];
  if (!askedEvent) throw new Error("missing asked event");
  expect(JSON.parse(askedEvent.payload)).toMatchObject({
    foodId: asked.id,
    byUserId: asked.createdBy,
  });
  expect(
    foods
      .filter((food) => food.verified)
      .map((food) => food.name)
      .sort(),
  ).toEqual(
    [
      "Pasta bolognese",
      "Min madpakke",
      "Havregrød",
      "Rugbrød med ost",
      "Æble",
      "Banan",
      "Mælk",
    ].sort(),
  );
  expect(foods.find((food) => food.name === "Rugbrød")).toMatchObject({
    origin: "off",
    verified: false,
    barcode: "2000000000015",
  });
  expect(foods.find((food) => food.name === "Kartoffel kogt")).toMatchObject({
    origin: "frida",
    verified: false,
  });
  for (const food of foods) {
    expect(food.photoKey).toBeNull();
    expect(JSON.parse(food.portions) as unknown[]).not.toHaveLength(0);
    if (food.verified) expect(food.origin).toBe("family");
    const events = await db.event.findMany({
      where: { spaceId, type: { in: ["food.created", "food.verified"] } },
    });
    const forFood = events.filter(
      (event) => (JSON.parse(event.payload) as { foodId: string }).foodId === food.id,
    );
    expect(forFood.map((event) => event.type).sort()).toEqual(
      food.verified ? ["food.created", "food.verified"] : ["food.created"],
    );
  }
  const meals = await db.meal.findMany({
    where: { spaceId },
    orderBy: { ts: "asc" },
    include: { byUser: true, items: { orderBy: { position: "asc" } } },
  });
  const today = meals.slice(-3);
  expect(today.map((meal) => [meal.ts.toISOString(), meal.totalCarbs, meal.byUser.name])).toEqual([
    ["2026-10-15T05:15:00.000Z", 38, "Mette"],
    ["2026-10-15T07:50:00.000Z", 14, "Alma"],
    ["2026-10-15T10:10:00.000Z", 50, "Jonas"],
  ]);
  expect(today[2]?.bolusTs?.toISOString()).toBe("2026-10-15T09:58:00.000Z");
  expect(today.map((meal) => meal.items.map((item) => item.name))).toEqual([
    ["Havregrød med æble"],
    ["Æble"],
    ["Rugbrød med ost", "Æble"],
  ]);
  expect(JSON.parse(foods.find((food) => food.name === "Æble")?.portions ?? "[]")).toEqual(
    expect.arrayContaining([
      { label: "1 mellem", carbs: 14 },
      { label: "½ mellem", carbs: 7 },
    ]),
  );
  expect(
    meals.slice(0, 4).map((meal) => (+meal.ts - +(meal.bolusTs ?? new Date(0))) / 60_000),
  ).toEqual([15, 5, 0, 10]);
  expect(new Set(meals.slice(0, 4).map((meal) => meal.totalCarbs)).size).toBeGreaterThan(1);
  const readings = await db.reading.findMany({ where: { spaceId }, orderBy: { ts: "asc" } });
  expect(readings).toHaveLength(13 * 288 + 181);
  expect(
    new Set(
      readings.map((row) =>
        new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Copenhagen" }).format(row.ts),
      ),
    ).size,
  ).toBe(14);
  expect(+(readings.at(-1)?.ts ?? new Date(0)) - +(readings[0]?.ts ?? new Date(0))).toBe(
    (readings.length - 1) * 300_000,
  );
  const events = await db.event.findMany({ where: { spaceId }, orderBy: { seq: "asc" } });
  expect(events.map((event) => event.seq)).toEqual(events.map((_, i) => i + 1));
  const readingEvents = events.filter((event) => event.type === "reading");
  expect(readingEvents).toHaveLength(readings.length);
  expect(
    new Set(readingEvents.map((event) => (JSON.parse(event.payload) as { ts: string }).ts)),
  ).toEqual(new Set(readings.map((reading) => reading.ts.toISOString())));
  const mealEvents = await db.event.findMany({ where: { spaceId, type: "meal.created" } });
  expect(mealEvents).toHaveLength(7);
  expect(
    new Set(mealEvents.map((event) => (JSON.parse(event.payload) as { mealId: string }).mealId)),
  ).toEqual(new Set(meals.map((meal) => meal.id)));
}, 180_000);

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

it("seeds nine foods and today's three meals through the emitting services", async () => {
  const { seed } = (await import(SEED)) as {
    seed: (options: { db: PrismaClient; now: () => Date }) => Promise<{ spaceId: string }>;
  };
  const { spaceId } = await seed({ db, now: () => new Date("2026-10-15T13:00:00Z") });
  const foods = await db.food.findMany({ where: { spaceId } });
  expect(foods).toHaveLength(9);
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
  expect(meals.map((meal) => [meal.ts.toISOString(), meal.totalCarbs, meal.byUser.name])).toEqual([
    ["2026-10-15T05:15:00.000Z", 38, "Mette"],
    ["2026-10-15T07:50:00.000Z", 14, "Alma"],
    ["2026-10-15T10:10:00.000Z", 50, "Jonas"],
  ]);
  expect(meals[2]?.bolusTs?.toISOString()).toBe("2026-10-15T09:58:00.000Z");
  expect(meals.map((meal) => meal.items.map((item) => item.name))).toEqual([
    ["Havregrød med æble"],
    ["Æble"],
    ["Rugbrød med ost", "et æble"],
  ]);
  const mealEvents = await db.event.findMany({ where: { spaceId, type: "meal.created" } });
  expect(mealEvents).toHaveLength(3);
  expect(
    new Set(mealEvents.map((event) => (JSON.parse(event.payload) as { mealId: string }).mealId)),
  ).toEqual(new Set(meals.map((meal) => meal.id)));
});

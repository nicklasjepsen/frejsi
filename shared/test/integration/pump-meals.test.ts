// Release-only: the web meal service's pump matching against SQL Server (v0.7.0 plan §6). A meal
// logged after a stored carb bolus takes it and the untouched pump meal is removed; a pump meal a
// carer deletes dismisses its bolus. Each write commits with its event rows, or not at all.
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it } from "vitest";

import { MemoryEventSink } from "../../src/events/memory";
import type { SessionContext } from "../../src/schemas/auth";
import type { CreateMealRequest, MealView, UpdateMealRequest } from "../../src/schemas/meal";
import { createEmptyDatabase, migrate, type ScratchDatabase } from "./database";

const MEALS = "@/lib/meals/service";
const REPOSITORY = "@/lib/meals/repository";
const WRITER = "@/lib/meals/transaction";
interface MealServices {
  createMeal(s: string, x: SessionContext, d: CreateMealRequest, deps: object): Promise<MealView>;
  updateMeal(
    s: string,
    id: string,
    x: SessionContext,
    d: UpdateMealRequest,
    deps: object,
  ): Promise<MealView>;
  deleteMeal(s: string, id: string, x: SessionContext, deps: object): Promise<void>;
}

let scratch: ScratchDatabase;
let db: PrismaClient;
let services: MealServices;
let deps: object;
let sink: MemoryEventSink;
let spaceId: string;
let session: SessionContext;
const at = (hhmm: string) => new Date(`2026-10-15T${hhmm}:00.000Z`);

beforeAll(async () => {
  scratch = await createEmptyDatabase("frejsi_pump_meals_it");
  migrate(scratch.url);
  db = new PrismaClient({ datasourceUrl: scratch.url });
  const user = await db.user.create({ data: { name: "Pump meal fixture" } });
  spaceId = (
    await db.space.create({ data: { name: "Pump meal fixture space", timezone: "Europe/Copenhagen" } })
  ).id;
  await db.membership.create({ data: { userId: user.id, spaceId, role: "carer" } });
  session = {
    userId: user.id,
    name: "Pump meal fixture",
    simpleMode: false,
    accent: "olive",
    theme: "system",
    locale: "en",
    memberships: [{ spaceId, role: "carer" }],
  };
  services = (await import(MEALS)) as MealServices;
  const { PrismaMealRepository } = (await import(REPOSITORY)) as {
    PrismaMealRepository: new (db: PrismaClient) => object;
  };
  const { createMealWriter } = (await import(WRITER)) as {
    createMealWriter: (db: PrismaClient, sink: MemoryEventSink) => unknown;
  };
  sink = new MemoryEventSink();
  deps = { repo: new PrismaMealRepository(db), write: createMealWriter(db, sink), photos: null };
});
afterAll(async () => {
  await db.$disconnect();
  await scratch.drop();
});

/** A carb bolus and the untouched pump meal the cycle made from it, as task 2 stores them. */
async function pumpMeal(ts: string, sourceId: string) {
  const bolus = await db.pumpBolus.create({
    data: { spaceId, sourceId, ts: at(ts), units: 2.4, kind: "standard", carbs: 45 },
  });
  const meal = await db.meal.create({
    data: {
      spaceId,
      byUserId: session.userId,
      ts: at(ts),
      totalCarbs: 45,
      symbol: "unknown",
      source: "pump",
      pumpBolusId: bolus.id,
      bolusTs: at(ts),
      items: { create: { position: 0, name: "Carbs from the pump", carbs: 45 } },
    },
  });
  return { bolus, meal };
}
const eventRows = async () =>
  (await db.event.findMany({ where: { spaceId }, orderBy: { seq: "asc" } })).map((row) => ({
    type: row.type,
    payload: JSON.parse(row.payload) as unknown,
  }));

it("links a meal logged after a carb bolus and removes the untouched pump meal, with its events", async () => {
  const { bolus, meal } = await pumpMeal("11:50", "ns-lunch");
  const view = await services.createMeal(
    spaceId,
    session,
    { ts: at("12:00").toISOString(), items: [{ name: "Fictional rye bread", carbs: 40 }] },
    deps,
  );
  expect(view).toMatchObject({
    pumpBolusId: bolus.id,
    bolusTs: at("11:50").toISOString(),
    bolusUnits: 2.4,
    pumpCarbs: 45,
  });
  expect(await db.meal.findUnique({ where: { id: meal.id } })).toBeNull();
  expect(await db.mealItem.count({ where: { mealId: meal.id } })).toBe(0);
  expect(await db.meal.count({ where: { spaceId, pumpBolusId: bolus.id } })).toBe(1);
  expect(await eventRows()).toEqual([
    {
      type: "meal.created",
      payload: { mealId: view.id, ts: at("12:00").toISOString(), totalCarbs: 40 },
    },
    { type: "pump.meals", payload: { updated: [], created: [], removed: [meal.id] } },
  ]);
  expect(sink.published.find((p) => p.envelope.type === "pump.meals")?.group).toBe(
    `space-${spaceId}-glucose`,
  );

  const moved = await services.updateMeal(
    spaceId,
    view.id,
    session,
    { ts: at("15:00").toISOString() },
    deps,
  );
  expect(moved).not.toHaveProperty("pumpBolusId");
  expect(await db.meal.findUniqueOrThrow({ where: { id: view.id } })).toMatchObject({
    pumpBolusId: null,
    bolusTs: null,
  });
});

it("dismisses the bolus of a pump meal a carer deletes, committed with meal.deleted", async () => {
  const { bolus, meal } = await pumpMeal("18:30", "ns-dinner");
  const before = await db.event.count({ where: { spaceId } });
  await services.deleteMeal(spaceId, meal.id, session, deps);
  expect(await db.meal.findUnique({ where: { id: meal.id } })).toBeNull();
  expect(await db.pumpBolus.findUniqueOrThrow({ where: { id: bolus.id } })).toMatchObject({
    mealDismissed: true,
  });
  expect((await eventRows()).slice(before)).toEqual([
    { type: "meal.deleted", payload: { mealId: meal.id } },
  ]);
});

it("never leaves one bolus on two meals when two meal writes race for it", async () => {
  const bolus = await db.pumpBolus.create({
    data: { spaceId, sourceId: "ns-race", ts: at("20:00"), units: 1.2, kind: "standard" },
  });
  const results = await Promise.allSettled(
    ["19:58", "20:03"].map((ts) =>
      services.createMeal(
        spaceId,
        session,
        { ts: at(ts).toISOString(), items: [{ name: "Fictional snack", carbs: 12 }] },
        deps,
      ),
    ),
  );
  expect(results.filter((r) => r.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
  expect(await db.meal.count({ where: { spaceId, pumpBolusId: bolus.id } })).toBe(1);
});

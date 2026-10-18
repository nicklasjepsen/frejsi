// Release-only checks of the real SQL constraints and the web service/query implementations.
import { readdirSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { lookup } from "../../src/food/lookup";
import { PrismaFoodRepository } from "../../src/food/repository";
import { FakeFoodSource } from "../../src/food/fake";
import { MemoryEventSink } from "../../src/events/memory";
import { createEmit } from "../../src/events/emit";
import { createLogger } from "../../src/log";
import { FakeAiProvider, type RecordedAiCall } from "../../src/ai/fake";
import { MemoryAiCallRepository } from "../../src/ai/calls";
import type { FoodCandidate, FoodView } from "../../src/schemas/food";
import type { SessionContext } from "../../src/schemas/auth";
import type { CreateMealRequest, DayView, MealView } from "../../src/schemas/meal";
import {
  SCHEMA,
  createEmptyDatabase,
  migrate,
  prismaCli,
  schemaDiff,
  type ScratchDatabase,
} from "./database";

vi.mock("@azure/functions", () => ({ app: { timer: vi.fn() } }));
const FOODS = "@/lib/foods";
const ENRICH = path.resolve(import.meta.dirname, "../../../poller/src/functions/enrich-foods.ts");
const MEALS = "@/lib/meals/service";
const REPOSITORY = "@/lib/meals/repository";
const WRITER = "@/lib/meals/transaction";
const DAY = "@/app/api/spaces/[spaceId]/day/load-day";
interface FoodServices {
  createFood(
    spaceId: string,
    session: SessionContext,
    input: unknown,
    deps: object,
  ): Promise<FoodView>;
  addCandidate(
    spaceId: string,
    session: SessionContext,
    input: FoodCandidate,
    deps: object,
  ): Promise<FoodView>;
  deleteFood(spaceId: string, session: SessionContext, id: string, deps: object): Promise<void>;
}
let scratch: ScratchDatabase;
let db: PrismaClient<{ log: [{ emit: "event"; level: "query" }] }>;
let services: FoodServices;
const sink = new MemoryEventSink();
beforeAll(async () => {
  scratch = await createEmptyDatabase("frejsi_food_it");
  // Give all ten concurrent transactions a connection, independently of the runner's CPU count.
  // Keep the production transaction timeout/retry behavior; this tests SQL races, not pool queuing.
  const url = `${scratch.url.replace(/;connectionLimit=[^;]*/gi, "")};connectionLimit=12`;
  db = new PrismaClient({ datasourceUrl: url, log: [{ emit: "event", level: "query" }] });
  services = (await import(FOODS)) as FoodServices;
});
afterAll(async () => {
  await db.$disconnect();
  await scratch.drop();
});

async function context() {
  const space = await db.space.create({
    data: { name: "Fictional food checks", timezone: "Europe/Copenhagen" },
  });
  const user = await db.user.create({ data: { name: "Fictional carer" } });
  const session: SessionContext = {
    userId: user.id,
    name: user.name,
    simpleMode: false,
    accent: "olive",
    theme: "system",
    locale: "da",
    memberships: [{ spaceId: space.id, role: "owner" }],
  };
  return { spaceId: space.id, session, deps: { db, sink, sources: [], photos: null } };
}

it("upgrades 0001_foundation to 0002_food with no schema drift", async () => {
  prismaCli(
    [
      "db",
      "execute",
      "--file",
      path.join(path.dirname(SCHEMA), "migrations/0001_foundation/migration.sql"),
      "--schema",
      SCHEMA,
    ],
    scratch.url,
  );
  prismaCli(
    ["migrate", "resolve", "--applied", "0001_foundation", "--schema", SCHEMA],
    scratch.url,
  );
  const before = await db.$queryRaw<
    { n: number }[]
  >`SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'Food'`;
  expect(before[0]?.n).toBe(0);
  migrate(scratch.url);
  expect(await db.food.count()).toBe(0);
  const applied = await db.$queryRaw<
    { migration_name: string }[]
  >`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`;
  // Every migration in the folder is applied, so a new one never needs this test edited.
  const migrationsDir = path.join(path.dirname(SCHEMA), "migrations");
  const onDisk = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  expect(onDisk[0]).toBe("0001_foundation");
  expect(applied.map((row) => row.migration_name)).toEqual(onDisk);
  expect(await schemaDiff(scratch.url, db)).not.toMatch(/CREATE|ALTER|DROP/);
});

it("resolves the SQL library before cache before a fake source", async () => {
  const { spaceId, session, deps } = await context();
  const own = await services.createFood(
    spaceId,
    session,
    { name: "Fictional stew library", portions: [{ label: "1 bowl", carbs: 20 }], verify: true },
    deps,
  );
  const repo = new PrismaFoodRepository(db);
  await repo.upsertCache({
    name: "Fictional stew cache",
    origin: "fake-local",
    sourceRef: "fake-local:cache",
    portions: [{ label: "1 bowl", carbs: 22 }],
    spaceId: null,
    verified: false,
  });
  const source = new FakeFoodSource({
    id: "fake-local",
    kind: "local",
    candidates: [
      {
        name: "Fictional stew source",
        origin: "fake-local",
        sourceRef: "fake-local:source",
        portions: [{ label: "1 bowl", carbs: 24 }],
      },
    ],
  });
  const result = await lookup(repo, [source], {
    spaceId,
    session,
    query: { q: "fictional stew" },
    locale: "en",
  });
  expect(result.results.map((row) => [row.source, row.food.name, row.verified])).toEqual([
    ["library", own.name, true],
    ["cache", "Fictional stew cache", false],
    ["fake-local", "Fictional stew source", false],
  ]);
});

it("ten concurrent addCandidate calls store one space copy and one creation event", async () => {
  const { spaceId, session, deps } = await context();
  const candidate: FoodCandidate = {
    name: "Fictional concurrent dish",
    origin: "fake-local",
    sourceRef: "fake-local:concurrent",
    portions: [{ label: "1 bowl", carbs: 18 }],
  };
  const source = new FakeFoodSource({ id: "fake-local", kind: "local", candidates: [candidate] });
  const results = await Promise.all(
    Array.from({ length: 10 }, () =>
      services.addCandidate(spaceId, session, candidate, { ...deps, sources: [source] }),
    ),
  );
  expect(new Set(results.map((food) => food.id)).size).toBe(1);
  expect(await db.food.count({ where: { spaceId, sourceRef: candidate.sourceRef } })).toBe(1);
  const events = await db.event.findMany({ where: { spaceId, type: "food.created" } });
  expect(events).toHaveLength(1);
  expect(JSON.parse(events[0]?.payload ?? "null") as unknown).toMatchObject({
    foodId: results[0]?.id,
  });
});

it("deleting a food nulls its meal link and preserves the snapshot; day never selects Reading", async () => {
  const { spaceId, session, deps } = await context();
  const food = await services.createFood(
    spaceId,
    session,
    { name: "Fictional snapshot dish", portions: [{ label: "1 bowl", carbs: 32 }], verify: true },
    deps,
  );
  const { PrismaMealRepository } = (await import(REPOSITORY)) as {
    PrismaMealRepository: new (db: PrismaClient) => object;
  };
  const { createMealWriter } = (await import(WRITER)) as {
    createMealWriter: (db: PrismaClient, sink: MemoryEventSink) => unknown;
  };
  const { createMeal } = (await import(MEALS)) as {
    createMeal: (
      spaceId: string,
      session: SessionContext,
      data: CreateMealRequest,
      deps: object,
    ) => Promise<MealView>;
  };
  const meal = await createMeal(
    spaceId,
    session,
    {
      ts: "2026-10-15T10:10:00Z",
      bolusTs: "2026-10-15T09:58:00Z",
      note: "Fictional private note",
      items: [{ foodId: food.id, name: food.name, portionLabel: "1 bowl", carbs: 32 }],
    },
    { repo: new PrismaMealRepository(db), write: createMealWriter(db, sink), photos: null },
  );
  await services.deleteFood(spaceId, session, food.id, deps);
  const item = await db.mealItem.findFirstOrThrow({ where: { mealId: meal.id } });
  expect(item).toMatchObject({ foodId: null, name: food.name, carbs: 32, portionLabel: "1 bowl" });
  await db.reading.create({
    data: {
      spaceId,
      ts: new Date("2026-10-15T10:00:00Z"),
      mmol: 6.2,
      trend: "flat",
      source: "fake",
    },
  });
  const queries: string[] = [];
  db.$on("query", (event) => queries.push(event.query));
  const { loadDay } = (await import(DAY)) as {
    loadDay: (spaceId: string, date: string, locale: "en", deps: object) => Promise<DayView>;
  };
  const day = await loadDay(spaceId, "2026-10-15", "en", {
    db,
    photos: null,
    now: () => new Date("2026-10-15T13:00:00Z"),
  });
  expect(day).toMatchObject({
    mealCount: 1,
    totalCarbs: 32,
    meals: [{ title: food.name, items: [{ name: food.name, carbs: 32 }] }],
  });
  expect(queries.some((query) => query.includes("Meal"))).toBe(true);
  expect(queries.join("\n")).not.toMatch(/Reading|mmol|trend|bolusTs|\[note\]/i);
  expect(JSON.stringify(day)).not.toMatch(/mmol|trend|reading|bolusTs|note|foodId/i);
});

it("the category pass places an unplaced food in the database, never a recipe, with food.updated in the same transaction (v0.6.0)", async () => {
  const { spaceId, session, deps } = await context();
  const loaf = await services.createFood(
    spaceId,
    session,
    {
      name: "Fictional seeded loaf",
      carbsPer100g: 40,
      portions: [{ label: "1 slice", grams: 45, carbs: 18 }],
      verify: true,
    },
    deps,
  );
  const dish = await services.createFood(
    spaceId,
    session,
    {
      name: "Fictional recipe dish",
      origin: "recipe",
      portions: [{ label: "1 portion", carbs: 30 }],
      recipe: {
        ingredients: [{ name: "Fictional flour", carbs: 120 }],
        yieldPortions: 4,
        source: { kind: "text", text: "flour" },
      },
    },
    deps,
  );
  const placed = await services.createFood(
    spaceId,
    session,
    { name: "Fictional pear", carbsPer100g: 12, portions: [], category: "fruit" },
    deps,
  );
  const picked = await services.addCandidate(
    spaceId,
    session,
    {
      name: "Fictional dataset loaf",
      origin: "fake-local",
      sourceRef: "fake-local:loaf",
      carbsPer100g: 38,
      portions: [{ label: "1 slice", grams: 45, carbs: 17 }],
    },
    {
      ...deps,
      sources: [
        new FakeFoodSource({
          id: "fake-local",
          kind: "local",
          candidates: [
            {
              name: "Fictional dataset loaf",
              origin: "fake-local",
              sourceRef: "fake-local:loaf",
              carbsPer100g: 38,
              portions: [{ label: "1 slice", grams: 45, carbs: 17 }],
            },
          ],
        }),
      ],
    },
  );
  await db.food.update({
    where: { id: picked.id },
    data: { verified: true, verifiedBy: session.userId, verifiedAt: new Date() },
  });
  const repo = new PrismaFoodRepository(db, sink);
  // The typed loaf is a person's text and never a candidate; the picked one is.
  expect((await repo.categoryCandidates([spaceId], 50, false)).map((row) => row.id)).toEqual([
    picked.id,
  ]);
  const before = await db.event.count({ where: { spaceId } });
  const { runEnrichment } = (await import(ENRICH)) as {
    runEnrichment: (deps: object) => Promise<void>;
  };
  const provider = new FakeAiProvider((call: RecordedAiCall) =>
    call.kind === "embed"
      ? { vectors: call.request.texts.map(() => [1, ...Array<number>(1023).fill(0)]), model: "f" }
      : { kind: "json" as const, json: { category: "bread" }, model: "f" },
  );
  await runEnrichment({
    repo,
    calls: new MemoryAiCallRepository(),
    emit: createEmit({ db, sink }),
    providers: { ollama: provider },
    remoteOrigins: [],
    spaces: [{ id: spaceId, aiEnabled: true, aiProvider: "ollama", timezone: "UTC", locale: "da" }],
    env: {},
    log: createLogger(() => undefined),
  });
  const rows = await db.food.findMany({ where: { spaceId }, orderBy: { name: "asc" } });
  const byId = (id: string) => rows.find((row) => row.id === id);
  expect(byId(picked.id)).toMatchObject({
    category: "bread",
    verified: true,
    verifiedBy: session.userId,
    name: "Fictional dataset loaf",
    portions: JSON.stringify([{ label: "1 slice", grams: 45, carbs: 17 }]),
  });
  expect(byId(loaf.id)?.category).toBeNull();
  expect(byId(dish.id)?.category).toBeNull();
  expect(byId(placed.id)?.category).toBe("fruit");
  const events = await db.event.findMany({
    where: { spaceId },
    orderBy: { seq: "asc" },
    skip: before,
  });
  expect(events.map((event) => [event.type, JSON.parse(event.payload) as unknown])).toEqual([
    ["food.updated", { foodId: picked.id }],
  ]);
  // Only the name reaches the model, once for the loaf; the dish and the placed pear never do.
  const asked = provider.calls.flatMap((call) =>
    call.kind === "complete"
      ? call.request.messages.flatMap((m) =>
          m.content.map((c) => (c.type === "text" ? c.text : "")),
        )
      : [],
  );
  expect(asked).toContain(JSON.stringify({ name: "Fictional dataset loaf", locale: "da" }));
  expect(asked.join()).not.toMatch(/seeded loaf|recipe dish|Fictional pear/);
  expect(await repo.categoryCandidates([spaceId], 50, false)).toEqual([]);
});

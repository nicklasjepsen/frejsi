// Release-only checks of the recipe save and recalc against a real SQL Server (v0.6.0 plan §6):
// the dish of origin `recipe` with its JSON, the lines resolved through lookup() against the SQL
// library, and a past meal's MealItem rows untouched by a recalc.
import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it } from "vitest";

import { MemoryEventSink } from "../../src/events/memory";
import { HttpError } from "../../src/schemas/api";
import type { SessionContext } from "../../src/schemas/auth";
import type { FoodView, Recipe, RecipeReview } from "../../src/schemas/food";
import type { CreateMealRequest, MealView } from "../../src/schemas/meal";
import { createEmptyDatabase, migrate, type ScratchDatabase } from "./database";

const FOODS = "@/lib/foods";
const RECIPES = "@/lib/recipes/service";
const READER = "@/ai/recipe/service";
const MEALS = "@/lib/meals/service";
const REPOSITORY = "@/lib/meals/repository";
const WRITER = "@/lib/meals/transaction";
interface FoodServices {
  createFood(
    spaceId: string,
    session: SessionContext,
    input: unknown,
    deps: object,
  ): Promise<FoodView>;
  getFood(spaceId: string, session: SessionContext, id: string, deps: object): Promise<FoodView>;
}
interface RecipeServices {
  reviewRecipe(
    spaceId: string,
    session: SessionContext,
    body: unknown,
    deps: object,
  ): Promise<RecipeReview>;
  saveRecipe(
    spaceId: string,
    session: SessionContext,
    body: unknown,
    deps: object,
  ): Promise<FoodView>;
  recalcRecipe(
    spaceId: string,
    session: SessionContext,
    foodId: string,
    body: unknown,
    deps: object,
  ): Promise<FoodView>;
}
let scratch: ScratchDatabase;
let db: PrismaClient;
let foods: FoodServices;
let recipes: RecipeServices;
const sink = new MemoryEventSink();
const fixture = readFileSync(
  path.resolve(import.meta.dirname, "../../../fixtures/recipes/lasagne.jsonld.html"),
  "utf8",
);

beforeAll(async () => {
  scratch = await createEmptyDatabase("frejsi_recipes_it");
  migrate(scratch.url);
  db = new PrismaClient({ datasourceUrl: scratch.url });
  foods = (await import(FOODS)) as FoodServices;
  recipes = (await import(RECIPES)) as RecipeServices;
  // AI is off for this space: the JSON-LD page must still read, text must not.
  const { configureRecipeReader } = (await import(READER)) as {
    configureRecipeReader(deps: { provider: () => Promise<never> }): void;
  };
  configureRecipeReader({ provider: () => Promise.reject(new HttpError(409, "ai-disabled")) });
});
afterAll(async () => {
  await db.$disconnect();
  await scratch.drop();
});

async function context() {
  const space = await db.space.create({
    data: { name: "Fictional recipe checks", timezone: "Europe/Copenhagen" },
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
  const deps = {
    db,
    sink,
    sources: [],
    photos: null,
    fetchPage: () => Promise.resolve(fixture),
  };
  return { spaceId: space.id, session, deps };
}

it("reads a JSON-LD page with AI off, resolves the lines through the SQL library, saves the dish and recalculates it without touching a past meal", async () => {
  const { spaceId, session, deps } = await context();
  const pasta = await foods.createFood(
    spaceId,
    session,
    { name: "Lasagneplader", carbsPer100g: 70, portions: [], verify: true },
    deps,
  );
  await foods.createFood(
    spaceId,
    session,
    {
      name: "Flåede tomater",
      portions: [{ label: "1 dåse", grams: 400, carbs: 12 }],
      verify: true,
    },
    deps,
  );
  await expect(
    recipes.reviewRecipe(spaceId, session, { text: "250 g lasagneplader" }, deps),
  ).rejects.toMatchObject({ code: "ai-disabled" });
  const review = await recipes.reviewRecipe(
    spaceId,
    session,
    { url: "https://recipes.example/lasagne" },
    deps,
  );
  expect(review).toMatchObject({ title: "Eksempellasagne", approx: false, yieldPortions: 6 });
  const byName = Object.fromEntries(review.lines.map((line) => [line.name, line]));
  expect(byName.lasagneplader).toMatchObject({ foodId: pasta.id, grams: 250, carbs: 175 });
  expect(byName["flåede tomater"]).toMatchObject({ grams: 800, carbs: 24 });
  expect(byName["salt og peber"]).toMatchObject({ carbs: 0, noCarb: true });
  expect(byName["hakket oksekød"]).toMatchObject({ carbs: 0 });
  expect(review.totalCarbs).toBe(199);
  expect(await db.food.count({ where: { spaceId, origin: "recipe" } })).toBe(0);

  const ingredients = review.lines.map(
    ({ match: _match, candidates: _candidates, ...line }) => line,
  );
  const dish = await recipes.saveRecipe(
    spaceId,
    session,
    { title: review.title, ingredients, yieldPortions: 6, source: review.source },
    deps,
  );
  expect(dish).toMatchObject({ origin: "recipe", verified: false, name: "Eksempellasagne" });
  expect(dish.portions).toEqual([
    { label: "1 portion", grams: 342, carbs: 33 },
    { label: "½ portion", grams: 171, carbs: 17 },
  ]);
  // 199 g over the 2050 g the lines weigh (the beef, the tinned tomatoes, the pasta, the milk).
  expect(dish.carbsPer100g).toBe(9.7);
  const row = await db.food.findUniqueOrThrow({ where: { id: dish.id } });
  expect(row).toMatchObject({
    origin: "recipe",
    verified: false,
    verifiedBy: null,
    sourceRef: `recipe:${dish.id}`,
  });
  const stored = JSON.parse(row.recipe ?? "null") as Recipe;
  expect(stored.source).toEqual({ kind: "url", url: "https://recipes.example/lasagne" });
  expect(stored.ingredients).toEqual(ingredients);
  expect(stored.yieldPortions).toBe(6);
  const events = await db.event.findMany({
    where: { spaceId, type: "food.created" },
    orderBy: { seq: "asc" },
  });
  expect(events.map((event) => (JSON.parse(event.payload) as { origin: string }).origin)).toEqual([
    "family",
    "family",
    "recipe",
  ]);

  const { PrismaMealRepository } = (await import(REPOSITORY)) as {
    PrismaMealRepository: new (db: PrismaClient) => object;
  };
  const { createMealWriter } = (await import(WRITER)) as {
    createMealWriter: (db: PrismaClient, sink: MemoryEventSink) => unknown;
  };
  const { createMeal } = (await import(MEALS)) as {
    createMeal(
      spaceId: string,
      session: SessionContext,
      data: CreateMealRequest,
      deps: object,
    ): Promise<MealView>;
  };
  const meal = await createMeal(
    spaceId,
    session,
    {
      ts: "2026-10-15T17:30:00Z",
      items: [{ foodId: dish.id, name: dish.name, portionLabel: "1 portion", carbs: 33 }],
    },
    { repo: new PrismaMealRepository(db), write: createMealWriter(db, sink), photos: null },
  );
  expect(meal.totalCarbs).toBe(33);
  const before = await db.mealItem.findMany({ where: { mealId: meal.id } });

  const edited = ingredients.map((line) =>
    line.name === "lasagneplader" ? { ...line, amount: 500, grams: 500, carbs: 350 } : line,
  );
  const recalculated = await recipes.recalcRecipe(
    spaceId,
    session,
    dish.id,
    { ingredients: edited },
    deps,
  );
  expect(recalculated.portions).toEqual([
    { label: "1 portion", grams: 383, carbs: 62 },
    { label: "½ portion", grams: 192, carbs: 31 },
  ]);
  expect(recalculated.carbsPer100g).toBe(16.3);
  expect(recalculated.verified).toBe(false);
  const after = await db.food.findUniqueOrThrow({ where: { id: dish.id } });
  expect((JSON.parse(after.recipe ?? "null") as Recipe).ingredients).toEqual(edited);
  expect(await db.mealItem.findMany({ where: { mealId: meal.id } })).toEqual(before);
  expect((await db.meal.findUniqueOrThrow({ where: { id: meal.id } })).totalCarbs).toBe(33);
  expect((await foods.getFood(spaceId, session, dish.id, deps)).recipe?.source).toEqual(
    stored.source,
  );
});

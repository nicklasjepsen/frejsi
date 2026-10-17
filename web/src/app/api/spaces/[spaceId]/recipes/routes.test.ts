// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { createLogger, type Food, type MealView } from "@frejsi/shared";
import { FakeAiProvider, defaultFakeAnswer } from "@frejsi/shared/ai/fake";
import { CappedAiProvider } from "@frejsi/shared/ai/capped";
import { MemoryAiCallRepository } from "@frejsi/shared/ai/calls";
import { HttpError } from "@frejsi/shared/schemas/api";
import { MemoryFoodRepository } from "@frejsi/shared/food/memory";
import type { MemoryPhotoStore } from "@frejsi/shared/photos/memory";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAuthDb } from "@/lib/auth/test-support";
import {
  seedSpace,
  request,
  params,
  USERS,
  T0,
  type Who,
} from "@/components/settings/route-test-support";
import { foodTestRig } from "@/lib/foods/test-fixture.test";
import { configureFoods } from "@/lib/foods/core";
import { configureRecipeReader } from "@/ai/recipe/service";
import { configureRecipes } from "@/lib/recipes/service";
import plate from "../estimates/fixtures/plate.json";
import { POST as parse } from "./parse/route";
import { POST as save } from "./route";
import { PATCH as recalc } from "./[foodId]/route";
import { GET as fromMeal } from "./meal/[mealId]/route";

const fixture = (name: string) =>
  readFileSync(
    path.resolve(import.meta.dirname, "../../../../../../../fixtures/recipes", name),
    "utf8",
  );

let rig: ReturnType<typeof foodTestRig>;
let auth: FakeAuthDb;
let fake: FakeAiProvider;
let calls: MemoryAiCallRepository;
let lines: string[];
let aiState: "on" | "disabled" | "not-configured";
let fetched: string[];
let page: string;
const libraryRow = (id: string, name: string, extra: Partial<Food> = {}): Food => ({
  id,
  spaceId: "s1",
  name,
  nameSearch: name.toLowerCase(),
  origin: "family",
  sourceRef: `family:${id}`,
  verified: true,
  favourite: false,
  portions: [],
  createdAt: T0.toISOString(),
  updatedAt: T0.toISOString(),
  ...extra,
});
const meal: MealView = {
  id: "m1",
  ts: T0.toISOString(),
  title: "Rye bread and pear",
  slot: "lunch",
  totalCarbs: 48,
  byUser: { id: USERS.carer, name: "Example Carer" },
  items: [
    { name: "Rye bread", portionLabel: "2 slices", carbs: 36 },
    { name: "Cloud pear", grams: 100, carbs: 12 },
  ],
};
beforeEach(() => {
  rig = foodTestRig();
  auth = new FakeAuthDb(() => T0);
  seedSpace(auth);
  rig.deps.now = () => T0;
  for (const user of auth.rows("user")) user.locale = "en";
  fake = new FakeAiProvider(defaultFakeAnswer);
  calls = new MemoryAiCallRepository();
  lines = [];
  aiState = "on";
  fetched = [];
  page = fixture("lasagne.jsonld.html");
  const repo = new MemoryFoodRepository([
    libraryRow("f-rye", "Rye bread", {
      carbsPer100g: 40,
      portions: [{ label: "1 slice", grams: 45, carbs: 18 }],
    }),
    libraryRow("f-pasta", "Lasagneplader", { carbsPer100g: 70 }),
    libraryRow("f-milk", "Maelk", { carbsPer100g: 5 }),
  ]);
  configureFoods({
    ...rig.deps,
    repo,
    sessionDb: auth.db,
    log: createLogger((line) => lines.push(line)),
  });
  configureRecipeReader({
    provider: (spaceId, session) => {
      if (aiState === "disabled") return Promise.reject(new HttpError(409, "ai-disabled"));
      if (aiState === "not-configured")
        return Promise.reject(new HttpError(503, "ai-not-configured"));
      return Promise.resolve(
        new CappedAiProvider(fake, calls, {
          spaceId,
          userId: session.userId,
          timezone: "UTC",
          dailyCap: 2,
          embedDailyCap: 1,
          now: () => T0,
        }),
      );
    },
  });
  configureRecipes({
    fetchPage: (url) => {
      fetched.push(url);
      return Promise.resolve(page);
    },
    meal: (_spaceId, _session, mealId) =>
      mealId === "m1" ? Promise.resolve(meal) : Promise.reject(new HttpError(404, "not-found")),
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  rig.reset();
  configureRecipeReader({});
  configureRecipes({});
});

type Handler = (
  request: Request,
  context: { params: Promise<Record<string, string>> },
) => Promise<Response>;
const call = (
  handler: unknown,
  body: unknown,
  options: { as?: Who | null; spaceId?: string; method?: string; path?: string } = {},
) =>
  (handler as Handler)(
    request(`/api/spaces/s1/recipes${options.path ?? ""}`, {
      method: options.method ?? "POST",
      body,
      as: options.as === undefined ? "carer" : options.as,
    }),
    params({
      spaceId: options.spaceId ?? "s1",
      foodId: options.path?.startsWith("/f-") ? options.path.slice(1) : "f-dish",
      mealId: options.path?.startsWith("/meal/") ? options.path.slice("/meal/".length) : "m1",
    }),
  );
const body = async (response: Response) => (await response.json()) as Record<string, unknown>;

describe("POST recipes/parse", () => {
  it("reads a JSON-LD page without a provider call, resolving every line through lookup with remote true", async () => {
    const response = await call(parse, { url: "https://recipes.example/lasagne" });
    expect(response.status).toBe(200);
    const review = await body(response);
    expect(fetched).toEqual(["https://recipes.example/lasagne"]);
    expect(fake.calls).toEqual([]);
    expect(calls.rows).toEqual([]);
    expect(review).toMatchObject({
      title: "Eksempellasagne",
      approx: false,
      yieldPortions: 6,
      source: { kind: "url", url: "https://recipes.example/lasagne" },
    });
    const lines = review.lines as Record<string, unknown>[];
    expect(lines.map((line) => line.name)).toEqual([
      "hakket oksekød",
      "flåede tomater",
      "løg",
      "lasagneplader",
      "mælk",
      "salt og peber",
    ]);
    // Library first: the space's own pasta, 250 g at 70 g per 100 g.
    expect(lines[3]).toMatchObject({
      foodId: "f-pasta",
      foodName: "Lasagneplader",
      grams: 250,
      carbs: 175,
      match: { id: "f-pasta" },
    });
    expect(lines[5]).toEqual({ name: "salt og peber", carbs: 0, noCarb: true });
    // Nothing matched the beef in the library or the cache, so the remote source answered.
    expect(lines[0]).toMatchObject({ foodName: "Cloud pear", grams: 500 });
    expect(review.totalCarbs).toBe(lines.reduce((sum, line) => sum + Number(line.carbs), 0));
    expect(rig.rows).toEqual([]);
    expect(rig.events).toEqual([]);
  });
  it("sends pasted text and a photo to the provider, use recipe, counted, and marks the review approx", async () => {
    const text = await call(parse, { text: fixture("lasagne.txt") });
    expect(text.status).toBe(200);
    expect(await body(text)).toMatchObject({
      approx: true,
      title: "Example stew",
      source: { kind: "text" },
    });
    const photo = await call(parse, { photoDataUrl: plate.photoDataUrl });
    expect(photo.status).toBe(200);
    expect(await body(photo)).toMatchObject({ approx: true, source: { kind: "photo" } });
    expect(fake.calls.map((c) => [c.kind, c.request.use])).toEqual([
      ["complete", "recipe"],
      ["vision", "recipe"],
    ]);
    expect(calls.rows).toHaveLength(2);
    expect((await call(parse, { text: "1 l water" })).status).toBe(429);
    expect(fake.calls).toHaveLength(2);
    expect(lines.join(" ")).not.toContain(plate.photoDataUrl.split(",")[1]);
    expect(lines.join(" ")).not.toContain("oksek");
  });
  it.each(["disabled", "not-configured"] as const)(
    "with AI %s: 409/503 for text and a photo, a JSON-LD page still works, a page without one is recipe-unreadable",
    async (state) => {
      aiState = state;
      const expected = state === "disabled" ? [409, "ai-disabled"] : [503, "ai-not-configured"];
      for (const input of [{ text: "500 g flour" }, { photoDataUrl: plate.photoDataUrl }]) {
        const response = await call(parse, input);
        expect(response.status).toBe(expected[0]);
        expect((await body(response)).error).toMatchObject({ code: expected[1] });
      }
      const structured = await call(parse, { url: "https://recipes.example/lasagne" });
      expect(structured.status).toBe(200);
      expect(await body(structured)).toMatchObject({ title: "Eksempellasagne", approx: false });
      page = "<html><p>Just prose, no structured data.</p></html>";
      const prose = await call(parse, { url: "https://recipes.example/prose" });
      expect(prose.status).toBe(422);
      expect((await body(prose)).error).toMatchObject({ code: "recipe-unreadable" });
      expect(fake.calls).toEqual([]);
    },
  );
  it("names an unnamed JSON-LD recipe in the person's language", async () => {
    page = `<html><script type="application/ld+json">${JSON.stringify({ "@type": "Recipe", recipeIngredient: ["1 l vand"] })}</script></html>`;
    expect((await body(await call(parse, { url: "https://recipes.example/unnamed" }))).title).toBe(
      "Recipe",
    );
    Object.assign(auth.rows("user").find((u) => u.id === USERS.carer) ?? {}, { locale: "da" });
    expect((await body(await call(parse, { url: "https://recipes.example/unnamed" }))).title).toBe(
      "Opskrift",
    );
  });
  it("passes a fetch failure through as recipe-fetch-failed and validates the one way in", async () => {
    configureRecipes({
      fetchPage: () => Promise.reject(new HttpError(502, "recipe-fetch-failed")),
    });
    const failed = await call(parse, { url: "https://recipes.example/down" });
    expect(failed.status).toBe(502);
    expect((await body(failed)).error).toMatchObject({ code: "recipe-fetch-failed" });
    for (const bad of [
      { url: "http://recipes.example/x" },
      { text: "" },
      { text: "a", url: "https://x.example" },
      {},
    ]) {
      expect((await call(parse, bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect((await call(parse, { photoDataUrl: "data:image/png;base64,AAAA" })).status).toBe(400);
    expect(fake.calls).toEqual([]);
  });
});

describe("POST recipes (Gem)", () => {
  const saveBody = {
    title: "Fictional lasagne",
    ingredients: [
      {
        name: "lasagneplader",
        amount: 250,
        unit: "g",
        grams: 250,
        foodId: "f-pasta",
        foodName: "Lasagneplader",
        carbs: 175,
      },
      {
        name: "milk",
        amount: 5,
        unit: "dl",
        grams: 500,
        foodId: "f-milk",
        foodName: "Maelk",
        carbs: 25,
      },
      { name: "salt og peber", carbs: 0, noCarb: true },
    ],
    yieldPortions: 4,
    source: { kind: "url", url: "https://recipes.example/lasagne" },
  };
  it("creates the dish with origin recipe, verified false, the computed carbs and portions, the recipe JSON and the photo", async () => {
    const response = await call(save, { ...saveBody, photoDataUrl: plate.photoDataUrl });
    expect(response.status).toBe(201);
    const food = await body(response);
    expect(food).toMatchObject({
      name: "Fictional lasagne",
      origin: "recipe",
      verified: false,
      carbsPer100g: 26.7,
      portions: [
        { label: "1 portion", grams: 188, carbs: 50 },
        { label: "½ portion", grams: 94, carbs: 25 },
      ],
      recipe: { ingredients: saveBody.ingredients, yieldPortions: 4, source: saveBody.source },
    });
    expect(food.photo).toBeDefined();
    expect(rig.rows).toHaveLength(1);
    expect(rig.rows[0]).toMatchObject({
      origin: "recipe",
      verified: false,
      createdBy: USERS.carer,
    });
    expect(rig.rows[0]?.sourceRef).toMatch(/^recipe:/);
    expect(JSON.parse(String(rig.rows[0]?.recipe))).toMatchObject({ source: saveBody.source });
    expect((rig.deps.photos as MemoryPhotoStore).photos.size).toBe(1);
    expect(rig.events.map((e) => e.type)).toEqual(["food.created", "food.updated"]);
    expect(rig.events[0]?.payload).toEqual({ foodId: food.id, origin: "recipe" });
    expect(fake.calls).toEqual([]);
    expect(lines.join(" ")).not.toContain(plate.photoDataUrl.split(",")[1]);
  });
  it("takes the portion names and the category the person set, and a yield in grams alone", async () => {
    const response = await call(save, {
      ...saveBody,
      yieldPortions: undefined,
      yieldGrams: 1000,
      category: "starch",
      portionLabels: { one: "1 tallerken", half: "½ tallerken" },
    });
    expect(response.status).toBe(201);
    expect(await body(response)).toMatchObject({
      carbsPer100g: 20,
      portions: [],
      category: "starch",
    });
    const named = await call(save, {
      ...saveBody,
      portionLabels: { one: "1 tallerken", half: "½ tallerken" },
    });
    expect((await body(named)).portions).toEqual([
      { label: "1 tallerken", grams: 188, carbs: 50 },
      { label: "½ tallerken", grams: 94, carbs: 25 },
    ]);
  });
  it("leaves no dish behind when the photo cannot be stored, so a retry does not double it", async () => {
    const store = rig.deps.photos as MemoryPhotoStore;
    const put = vi.spyOn(store, "put").mockRejectedValue(new Error("blob down"));
    const response = await call(save, { ...saveBody, photoDataUrl: plate.photoDataUrl });
    expect(response.status).toBe(503);
    expect((await body(response)).error).toMatchObject({ code: "photo-unavailable" });
    expect(put).toHaveBeenCalledTimes(1);
    expect(rig.rows).toEqual([]);
    expect(rig.events).toEqual([]);
    expect(rig.published).toEqual([]);
    expect(store.photos.size).toBe(0);
    put.mockRestore();
    const retry = await call(save, { ...saveBody, photoDataUrl: plate.photoDataUrl });
    expect(retry.status).toBe(201);
    expect(rig.rows).toHaveLength(1);
    expect(rig.published.map((e) => e.type)).toEqual(["food.created", "food.updated"]);
  });
  it("refuses a recipe without a yield or without lines, and never writes before validation", async () => {
    for (const bad of [
      { ...saveBody, yieldPortions: undefined },
      { ...saveBody, ingredients: [] },
      { ...saveBody, verified: true },
      { ...saveBody, origin: "family" },
    ])
      expect((await call(save, bad)).status).toBe(400);
    expect(rig.rows).toEqual([]);
    expect(rig.events).toEqual([]);
  });
});

describe("PATCH recipes/[foodId]", () => {
  beforeEach(async () => {
    const created = await call(save, {
      title: "Fictional lasagne",
      ingredients: [
        {
          name: "lasagneplader",
          amount: 250,
          unit: "g",
          grams: 250,
          foodId: "f-pasta",
          foodName: "Lasagneplader",
          carbs: 175,
        },
        { name: "salt", carbs: 0, noCarb: true },
      ],
      yieldPortions: 4,
      source: { kind: "text", text: "250 g lasagneplader, salt" },
    });
    const food = await body(created);
    rig.events.length = 0;
    const row = rig.rows[0];
    if (row) row.id = "f-dish";
    expect(food.carbsPer100g).toBe(70);
  });
  it("recalculates carbs per 100 g and the portions from an edited line, keeping the source", async () => {
    const response = await call(
      recalc,
      {
        ingredients: [
          {
            name: "lasagneplader",
            amount: 500,
            unit: "g",
            grams: 500,
            foodId: "f-pasta",
            foodName: "Lasagneplader",
            carbs: 350,
          },
          { name: "salt", carbs: 0, noCarb: true },
        ],
        yieldPortions: 5,
      },
      { method: "PATCH", path: "/f-dish" },
    );
    expect(response.status).toBe(200);
    expect(await body(response)).toMatchObject({
      carbsPer100g: 70,
      portions: [
        { label: "1 portion", grams: 100, carbs: 70 },
        { label: "½ portion", grams: 50, carbs: 35 },
      ],
      recipe: { yieldPortions: 5, source: { kind: "text" } },
      verified: false,
    });
    expect(rig.events.map((e) => e.type)).toEqual(["food.updated"]);
    expect(fake.calls).toEqual([]);
  });
  it("refuses a dish that is not from a recipe, an empty patch and a patch that clears the only yield", async () => {
    rig.seed({ id: "f-plain", origin: "family", recipe: null });
    expect(
      (await call(recalc, { yieldPortions: 2 }, { method: "PATCH", path: "/f-plain" })).status,
    ).toBe(400);
    expect((await call(recalc, {}, { method: "PATCH", path: "/f-dish" })).status).toBe(400);
    const response = await call(
      recalc,
      { yieldPortions: null },
      { method: "PATCH", path: "/f-dish" },
    );
    expect(response.status).toBe(400);
    expect(rig.events).toEqual([]);
  });
});

describe("GET recipes/meal/[mealId] (Gem som opskrift)", () => {
  it("opens the meal's items as lines with their amounts as the yield of one portion, no model call", async () => {
    const response = await call(fromMeal, undefined, { method: "GET", path: "/meal/m1" });
    expect(response.status).toBe(200);
    const review = await body(response);
    expect(review).toMatchObject({
      title: "Rye bread and pear",
      approx: false,
      yieldPortions: 1,
      totalCarbs: 48,
      source: { kind: "meal", mealId: "m1" },
    });
    expect(review.lines).toEqual([
      { name: "Rye bread", amount: 2, unit: "slice", foodName: "Rye bread", carbs: 36 },
      { name: "Cloud pear", amount: 100, unit: "g", grams: 100, foodName: "Cloud pear", carbs: 12 },
    ]);
    expect(review.yieldGrams).toBeUndefined();
    expect(fake.calls).toEqual([]);
    expect(rig.events).toEqual([]);
    expect((await call(fromMeal, undefined, { method: "GET", path: "/meal/m2" })).status).toBe(404);
  });
});

describe("who may", () => {
  it.each([
    ["parse", parse, { text: "500 g flour" }, "POST", ""],
    [
      "save",
      save,
      {
        title: "x",
        ingredients: [{ name: "x", carbs: 1 }],
        yieldPortions: 1,
        source: { kind: "text" },
      },
      "POST",
      "",
    ],
    ["recalc", recalc, { yieldPortions: 2 }, "PATCH", "/f-dish"],
    ["from meal", fromMeal, undefined, "GET", "/meal/m1"],
  ])(
    "%s: a viewer, a stranger and no session are refused before any provider call or write",
    async (_name, handler, payload, method, path) => {
      for (const [as, spaceId, status] of [
        ["viewer", "s1", 403],
        ["carer", "other", 404],
        [null, "s1", 403],
      ] as const) {
        expect((await call(handler, payload, { as, spaceId, method, path })).status).toBe(status);
      }
      Object.assign(auth.rows("user").find((u) => u.id === USERS.carer) ?? {}, {
        simpleMode: true,
      });
      const simple = await call(handler, payload, { method, path });
      expect(simple.status).toBe(400);
      expect((await body(simple)).error).toMatchObject({ code: "simple-mode" });
      expect(fake.calls).toEqual([]);
      expect(fetched).toEqual([]);
      expect(rig.events).toEqual([]);
    },
  );
});

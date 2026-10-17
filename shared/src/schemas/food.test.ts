import { describe, expect, it } from "vitest";
import { findDosingVocabulary, schemaVocabulary } from "../dosing-vocabulary";
import * as food from "./food";
import { ContributionResult, ContributionsView, FoodCorrection, FoodView } from "./food";
import * as exported from "./index";
const base = {
  id: "f1",
  name: "Example loaf",
  origin: "manual",
  portions: [],
  verified: false,
  favourite: false,
  createdAt: "2026-10-14T08:00:00Z",
  updatedAt: "2026-10-15T08:00:00Z",
};
it("accepts additive food provenance without exposing glucose", () => {
  const enriched = {
    ...base,
    sourceName: "EXAMPLE LOAF",
    createdBy: { id: "u1", name: "Example Person" },
    createdAt: "2026-10-14T08:00:00Z",
  };
  expect(FoodView.parse(enriched)).toEqual(enriched);
  expect(FoodView.parse(base)).toEqual(base);
  const { createdAt: _createdAt, ...missingTimestamp } = base;
  expect(FoodView.safeParse(missingTimestamp).success).toBe(false);
  expect(FoodView.safeParse({ ...enriched, createdBy: "u1" }).success).toBe(false);
  expect(FoodView.safeParse({ ...enriched, createdAt: "yesterday" }).success).toBe(false);
  expect(
    schemaVocabulary({ FoodView }).filter(([, key]) =>
      /^(mmol|mgdl|trend|reading|readings|glucose)$/i.test(key),
    ),
  ).toEqual([]);
});

const valid = {
  barcode: "2000000000008",
  carbsPer100g: 40,
  servingSize: { grams: 45 },
  appRef: "a1",
};

describe("FoodCorrection", () => {
  it("accepts a correction and normalises the barcode", () => {
    expect(FoodCorrection.parse(valid)).toEqual(valid);
    expect(
      FoodCorrection.parse({ barcode: "2000000000008", appRef: "a1" }).carbsPer100g,
    ).toBeUndefined();
    expect(
      FoodCorrection.parse({ ...valid, servingSize: { grams: 45, label: "1 skive" } }),
    ).toBeTruthy();
  });
  it("rejects a name key, a bad checksum and out-of-range values", () => {
    expect(FoodCorrection.safeParse({ ...valid, name: "Rugbrød" }).success).toBe(false);
    expect(FoodCorrection.safeParse({ ...valid, barcode: "2000000000009" }).success).toBe(false);
    expect(FoodCorrection.safeParse({ ...valid, carbsPer100g: 100.5 }).success).toBe(false);
    expect(FoodCorrection.safeParse({ ...valid, carbsPer100g: 40.25 }).success).toBe(false);
    expect(FoodCorrection.safeParse({ ...valid, servingSize: { grams: 0 } }).success).toBe(false);
    expect(FoodCorrection.safeParse({ ...valid, servingSize: { grams: 5001 } }).success).toBe(
      false,
    );
    expect(FoodCorrection.safeParse({ ...valid, appRef: "" }).success).toBe(false);
    expect(FoodCorrection.safeParse({ ...valid, appRef: "x".repeat(65) }).success).toBe(false);
  });
});

describe("ContributionResult", () => {
  it("accepts the five statuses only", () => {
    for (const status of ["ok", "bad-credentials", "rejected", "rate-limited", "error"])
      expect(ContributionResult.parse({ status })).toEqual({ status });
    expect(ContributionResult.safeParse({ status: "maybe" }).success).toBe(false);
    expect(ContributionResult.safeParse({ status: "ok", message: "x" }).success).toBe(false);
  });
});

describe("ContributionsView", () => {
  it("lists plugin ids and nothing else", () => {
    expect(ContributionsView.parse({ available: ["off"] })).toEqual({ available: ["off"] });
    expect(ContributionsView.safeParse({ available: ["Not An Id"] }).success).toBe(false);
    expect(ContributionsView.safeParse({ available: ["off"], host: "x" }).success).toBe(false);
    expect(Object.keys(ContributionsView.shape)).toEqual(["available"]);
  });
});

describe("food categories, the meal symbol and recipes (v0.6.0 plan §4)", () => {
  const recipe = {
    ingredients: [{ name: "Fictional flour", amount: 500, unit: "g", grams: 500, carbs: 360 }],
    yieldPortions: 4,
    source: { kind: "text", text: "500 g flour" },
  };
  it("has exactly the ten categories, and the symbol adds unknown", () => {
    expect(food.FoodCategory.options).toEqual([
      "bread",
      "fruit",
      "vegetables",
      "dairy",
      "starch",
      "protein",
      "sweets",
      "snack",
      "drink",
      "mixed",
    ]);
    expect(food.MealSymbol.options).toEqual([...food.FoodCategory.options, "unknown"]);
    expect(food.FoodCategory.safeParse("unknown").success).toBe(false);
    expect(food.FoodCategory.safeParse("pasta").success).toBe(false);
  });
  it("carries an optional category on candidates, foods, views and requests, and a recipe on own foods", () => {
    const candidate = { name: "Example loaf", portions: [], origin: "off", sourceRef: "off:1" };
    expect(food.FoodCandidate.parse({ ...candidate, category: "bread" }).category).toBe("bread");
    expect(food.FoodCandidate.parse(candidate).category).toBeUndefined();
    expect(food.FoodCandidate.safeParse({ ...candidate, category: "loaf" }).success).toBe(false);
    expect(food.FoodView.parse({ ...base, category: "fruit", recipe })).toMatchObject({
      category: "fruit",
      recipe,
    });
    expect(food.FoodView.parse(base).category).toBeUndefined();
    const row = {
      ...base,
      spaceId: "s1",
      nameSearch: "example loaf",
      sourceRef: "manual:f1",
      carbsPer100g: 40,
    };
    expect(food.Food.parse({ ...row, category: "dairy", recipe })).toMatchObject({
      category: "dairy",
      recipe,
    });
    expect(food.Food.parse(row).category).toBeUndefined();
    expect(
      food.CreateFoodRequest.parse({ name: "Example dish", carbsPer100g: 20, category: "starch" })
        .category,
    ).toBe("starch");
    expect(
      food.CreateFoodRequest.parse({
        name: "Example dish",
        carbsPer100g: 20,
        origin: "recipe",
        recipe,
      }),
    ).toMatchObject({ origin: "recipe", recipe });
    expect(
      food.CreateFoodRequest.safeParse({ name: "Example dish", carbsPer100g: 20, origin: "family" })
        .success,
    ).toBe(false);
    expect(food.UpdateFoodRequest.parse({ category: "protein" })).toEqual({ category: "protein" });
    expect(food.UpdateFoodRequest.parse({ category: null })).toEqual({ category: null });
    expect(food.UpdateFoodRequest.parse({ recipe })).toEqual({ recipe });
    expect(food.UpdateFoodRequest.safeParse({ category: "loaf" }).success).toBe(false);
  });
  it("rejects a recipe without a yield, with no lines or with more than 40 lines", () => {
    expect(food.Recipe.parse(recipe)).toEqual(recipe);
    expect(food.Recipe.parse({ ...recipe, yieldPortions: undefined, yieldGrams: 900 })).toEqual({
      ...recipe,
      yieldPortions: undefined,
      yieldGrams: 900,
    });
    expect(food.Recipe.safeParse({ ...recipe, yieldPortions: undefined }).success).toBe(false);
    expect(food.Recipe.safeParse({ ...recipe, ingredients: [] }).success).toBe(false);
    expect(
      food.Recipe.safeParse({
        ...recipe,
        ingredients: Array.from({ length: 41 }, () => ({ name: "Fictional item", carbs: 1 })),
      }).success,
    ).toBe(false);
    expect(food.RecipeIngredient.parse({ name: "Water", carbs: 0, noCarb: true })).toEqual({
      name: "Water",
      carbs: 0,
      noCarb: true,
    });
    expect(
      food.RecipeIngredient.safeParse({ name: "Fictional flour", carbs: 1.5 }).success,
    ).toBe(false);
    for (const source of [
      { kind: "photo", photoKey: "spaces/s1/foods/f1/abc" },
      { kind: "url", url: "https://example.invalid/recipe" },
      { kind: "meal", mealId: "m1" },
    ])
      expect(food.RecipeSource.parse(source)).toEqual(source);
    expect(food.RecipeSource.safeParse({ kind: "text", text: "x".repeat(4001) }).success).toBe(
      false,
    );
    expect(food.RecipeSource.safeParse({ kind: "url", url: "http://example.invalid" }).success).toBe(
      false,
    );
  });
  it("reviews a parsed recipe with matches and candidates per line", () => {
    const review = {
      title: "Fictional loaf",
      lines: [
        { ...recipe.ingredients[0], match: { ...base, carbsPer100g: 72 } },
        { name: "Water", carbs: 0, noCarb: true, candidates: [] },
      ],
      totalCarbs: 360,
      yieldPortions: 4,
      source: recipe.source,
      approx: true,
    };
    expect(food.RecipeReview.parse(review)).toEqual(review);
    expect(food.RecipeReview.safeParse({ ...review, approx: undefined }).success).toBe(false);
  });
  it("is exported from the schema index with no dosing or glucose word", () => {
    for (const name of [
      "FoodCategory",
      "MealSymbol",
      "Recipe",
      "RecipeIngredient",
      "RecipeSource",
      "RecipeReview",
    ])
      expect(exported).toHaveProperty(name, (food as Record<string, unknown>)[name]);
    const vocabulary = schemaVocabulary(food);
    expect(findDosingVocabulary(vocabulary)).toEqual([]);
    expect(
      vocabulary.filter(([, key]) => /^(mmol|mgdl|trend|reading|readings|glucose)$/i.test(key)),
    ).toEqual([]);
  });
});

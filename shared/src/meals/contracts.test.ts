import { readFileSync } from "node:fs";

import { describe, expect, expectTypeOf, it } from "vitest";
import type { z } from "zod";

import * as food from "../schemas/food";
import * as meal from "../schemas/meal";
import { ApiErrorCode } from "../schemas/api";
import { EventEnvelope, EventPayloads, type EventEnvelopeOf } from "../schemas/events";
import { schemaVocabulary, findDosingVocabulary } from "../dosing-vocabulary";
import * as publicExports from "../index";
import { normaliseBarcode } from "../food/barcode";
import { carbsFor } from "../food/portions";
import { foldForSearch } from "../food/search";

const ts = "2026-10-14T10:10:00.000Z";
const candidate = {
  name: "Fictional loaf",
  carbsPer100g: 40,
  portions: [],
  origin: "usda",
  sourceRef: "usda:1",
};
const view = {
  id: "f1",
  name: candidate.name,
  carbsPer100g: 40,
  portions: [],
  origin: "manual",
  verified: false,
  favourite: false,
  updatedAt: ts,
};
const row = {
  ...view,
  spaceId: "s1",
  nameSearch: "fictional loaf",
  sourceRef: "manual:f1",
  createdAt: ts,
};
const item = { name: "Fictional loaf", grams: 45, carbs: 18 };
const dayMeal = {
  id: "m1",
  ts,
  title: item.name,
  slot: "lunch",
  totalCarbs: 18,
  byUser: { id: "u1", name: "Example Person" },
  items: [item],
};
const day = {
  date: "2026-10-14",
  timezone: "Europe/Copenhagen",
  totalCarbs: 18,
  mealCount: 1,
  lastMealAt: ts,
  meals: [dayMeal],
};

const cases: [string, z.ZodType, unknown, unknown][] = [
  ["Portion", food.Portion, { label: "1 slice", carbs: 18 }, { label: "", carbs: 1.5 }],
  ["FoodOrigin", food.FoodOrigin, "usda", "Off!"],
  ["Food", food.Food, row, { ...row, sourceRef: "" }],
  ["FoodView", food.FoodView, view, { ...view, glucose: 6 }],
  ["FoodCandidate", food.FoodCandidate, candidate, { ...candidate, verified: true }],
  ["LookupQuery", food.LookupQuery, { q: "a" }, { barcode: "2000000000000" }],
  [
    "LookupResult",
    food.LookupResult,
    { source: "usda", verified: false, food: candidate },
    { source: "usda", verified: true, food: candidate },
  ],
  [
    "LookupResponse",
    food.LookupResponse,
    { results: [], sources: { usda: "ok" }, manual: { name: "a" } },
    { results: [], sources: { usda: "broken" }, manual: {} },
  ],
  [
    "CreateFoodRequest",
    food.CreateFoodRequest,
    { name: "Example dish", portions: [{ label: "bowl", carbs: 42 }] },
    { name: "Example dish", portions: [] },
  ],
  [
    "AddCandidateRequest",
    food.AddCandidateRequest,
    { candidate },
    { candidate: { ...candidate, portions: [], carbsPer100g: undefined } },
  ],
  ["UpdateFoodRequest", food.UpdateFoodRequest, { favourite: true }, { verified: true }],
  ["VerifyFoodsRequest", food.VerifyFoodsRequest, { foodIds: ["f1"] }, { foodIds: [] }],
  [
    "MealItemInput",
    meal.MealItemInput,
    { foodId: "f1", name: item.name, grams: 45 },
    { name: item.name },
  ],
  ["CreateMealRequest", meal.CreateMealRequest, { items: [item] }, { items: [] }],
  ["UpdateMealRequest", meal.UpdateMealRequest, { note: "Example lunch" }, { items: [] }],
  ["MealItemView", meal.MealItemView, item, { ...item, foodId: "f1" }],
  [
    "MealView",
    meal.MealView,
    { ...dayMeal, note: "Example lunch", bolusTs: ts },
    { ...dayMeal, totalCarbs: -1 },
  ],
  ["DayMealView", meal.DayMealView, dayMeal, { ...dayMeal, note: "private", bolusTs: ts }],
  ["DayView", meal.DayView, day, { ...day, glucose: 6 }],
];

describe("food and meal contracts", () => {
  it.each(cases)(
    "exports %s and accepts a valid shape and rejects an invalid one",
    (name, schema, valid, invalid) => {
      expect(publicExports).toHaveProperty(name, schema);
      expect(schema.safeParse(valid).success).toBe(true);
      expect(schema.safeParse(invalid).success).toBe(false);
    },
  );

  it.each([
    { name: "candidate", schema: food.FoodCandidate, input: candidate },
    {
      name: "create",
      schema: food.CreateFoodRequest,
      input: { name: "Example dish", carbsPer100g: 20 },
    },
    { name: "update", schema: food.UpdateFoodRequest, input: { name: "Example dish" } },
  ])("bounds the folded name at the storage limit for $name", ({ schema, input }) => {
    expect(schema.safeParse({ ...input, name: "æ".repeat(100) }).success).toBe(true);
    expect(schema.safeParse({ ...input, name: "æ".repeat(101) }).success).toBe(false);
  });

  it("keeps source candidates with unknown nutrition available for manual completion", () => {
    const unknown = { ...candidate, carbsPer100g: null, portions: [] };
    expect(food.FoodCandidate.parse(unknown)).toEqual(unknown);
    expect(food.FoodCandidate.parse({ ...unknown, carbsPer100g: undefined }).portions).toEqual([]);
    expect(food.AddCandidateRequest.safeParse({ candidate: unknown }).success).toBe(false);
    expect(
      food.CreateFoodRequest.safeParse({ name: unknown.name, carbsPer100g: null }).success,
    ).toBe(false);
  });

  it("defaults creation and lookup to safe values", () => {
    const { verified: _verified, ...unverified } = row;
    expect(food.Food.parse(unverified).verified).toBe(false);
    expect(food.FoodView.parse({ ...view, verified: undefined }).verified).toBe(false);
    expect(food.LookupQuery.parse({ q: "a" })).toEqual({ q: "a", remote: true });
    expect(food.LookupQuery.parse({ q: "abc", remote: false })).toEqual({
      q: "abc",
      remote: false,
    });
    expect(food.LookupQuery.safeParse({ q: "abc", barcode: "2000000000008" }).success).toBe(false);
    expect(
      food.CreateFoodRequest.safeParse({ name: "dish", carbsPer100g: 20, verified: true }).success,
    ).toBe(false);
    expect(
      food.LookupResult.safeParse({
        source: "cache",
        verified: true,
        food: { ...view, verified: true },
      }).success,
    ).toBe(false);
    expect(
      food.LookupResult.safeParse({
        source: "usda",
        verified: false,
        food: { ...view, verified: true },
      }).success,
    ).toBe(false);
    expect(
      food.LookupResult.safeParse({ source: "library", verified: false, food: candidate }).success,
    ).toBe(false);
  });

  it("walks strict public views recursively without glucose or dosing fields", () => {
    const keys = schemaVocabulary({ FoodView: food.FoodView, DayView: meal.DayView });
    const forbidden = new Set(["mmol", "mgdl", "trend", "reading", "readings", "glucose"]);
    expect(keys.filter(([, key]) => forbidden.has(key.toLowerCase()))).toEqual([]);
    expect(findDosingVocabulary(schemaVocabulary({ ...food, ...meal }))).toEqual([]);
    expect(
      meal.DayView.safeParse({ ...day, meals: [{ ...dayMeal, items: [{ ...item, mmol: 6 }] }] })
        .success,
    ).toBe(false);
    expect(
      food.FoodView.safeParse({ ...view, portions: [{ label: "slice", carbs: 18, readings: [] }] })
        .success,
    ).toBe(false);
    expectTypeOf<meal.MealItemView>().not.toHaveProperty("foodId");
    expectTypeOf<meal.DayMealView>().not.toHaveProperty("note");
    expectTypeOf<meal.DayMealView>().not.toHaveProperty("bolusTs");
  });

  const events = {
    "food.created": { foodId: "f1", origin: "usda" },
    "food.updated": { foodId: "f1" },
    "food.verified": { foodId: "f1", verifiedBy: "u1" },
    "food.deleted": { foodId: "f1" },
    "meal.created": { mealId: "m1", ts, totalCarbs: 18 },
    "meal.updated": { mealId: "m1" },
    "meal.deleted": { mealId: "m1" },
  } as const;
  it.each(Object.entries(events))("narrows and validates %s without glucose", (type, payload) => {
    const envelope = { spaceId: "s1", seq: 1, ts, type, payload };
    expect(EventEnvelope.parse(envelope)).toEqual(envelope);
    expect(EventEnvelope.safeParse({ ...envelope, payload: {} }).success).toBe(false);
    expect(
      EventEnvelope.safeParse({ ...envelope, payload: { ...payload, glucose: 6 } }).success,
    ).toBe(false);
    const parsed = EventEnvelope.parse(envelope);
    if (parsed.type === "meal.created")
      expectTypeOf(parsed.payload).toEqualTypeOf<{
        mealId: string;
        ts: string;
        totalCarbs: number;
      }>();
    if (parsed.type === "food.created")
      expectTypeOf(parsed.payload).toEqualTypeOf<{ foodId: string; origin: string }>();
    expectTypeOf<EventEnvelopeOf<"food.verified">["payload"]>().toEqualTypeOf<{
      foodId: string;
      verifiedBy: string;
    }>();
    const keys = schemaVocabulary({ payload: EventPayloads[type as keyof typeof events] });
    expect(keys.some(([, key]) => /^(mmol|mgdl|trend|reading|readings|glucose)$/i.test(key))).toBe(
      false,
    );
  });

  it.each([
    "simple-mode",
    "photo-too-large",
    "photo-type",
    "photo-unavailable",
    "barcode-invalid",
    "lookup-unavailable",
  ])("translates API code %s in both locales", (code) => {
    expect(ApiErrorCode.safeParse(code).success).toBe(true);
    for (const locale of ["da", "en"]) {
      const messages = JSON.parse(
        readFileSync(new URL(`../../../web/messages/${locale}.json`, import.meta.url), "utf8"),
      ) as { errors: { api: Record<string, string> } };
      expect(messages.errors.api[code]).toEqual(expect.any(String));
    }
  });
});

describe("food arithmetic and matching", () => {
  it("folds generic Latin text without depending on a locale", () => {
    expect(foldForSearch("Rugbrød, Fiktiv Bageri")).toBe("rugbrod, fiktiv bageri");
    expect(foldForSearch("Crème brûlée")).toBe("creme brulee");
    expect(foldForSearch("Æ Ø ß Ð Þ Ł Đ Œ")).toBe("ae o ss d th l d oe");
  });
  it("uses stored portions and rounds weighed carbs half up", () => {
    expect(carbsFor({ carbsPer100g: 40 }, 45)).toBe(18);
    expect(carbsFor({ carbsPer100g: 40 }, { label: "½ skive", grams: 22, carbs: 9 })).toBe(9);
    expect(carbsFor({ carbsPer100g: 50 }, 1)).toBe(1);
    expect(carbsFor({ carbsPer100g: 1.4 }, 2750)).toBe(39);
    expect(carbsFor({}, { label: "bowl", carbs: 42 })).toBe(42);
    expect(() => carbsFor({}, 45)).toThrow();
    expect(() => carbsFor({ carbsPer100g: null }, 45)).toThrow();
  });
  it("validates EAN and UPC checksums and canonicalises UPC-A", () => {
    expect(normaliseBarcode("036000291452")).toBe("0036000291452");
    expect(normaliseBarcode("2000000000008")).toBe("2000000000008");
    expect(normaliseBarcode("20000004")).toBe("20000004");
    for (const invalid of [
      "2000000000000",
      "20000005",
      "036000291453",
      "abcdefgh",
      " 20000004",
      "123",
    ])
      expect(normaliseBarcode(invalid)).toBeNull();
  });
});

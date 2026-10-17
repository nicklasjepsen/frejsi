import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { schemaVocabulary } from "../dosing-vocabulary";
import * as ai from "./ai";
import * as exported from "./index";

const item = { name: "Example pasta", carbs: 30, confidence: "medium", approx: true };
const estimate = { items: [item], totalCarbs: 30, dishName: "Example dish", approx: true };
const inRange = {
  minutes: 120,
  coveredMinutes: 180,
  windowMinutes: 180,
  complete: true,
  belowMinutes: 0,
  aboveMinutes: 60,
};
const stats = { inRange, readingCount: 36, leadMinutes: 10 };
const numbers = {
  lowEpisodes: { count: 0, atNight: 0 },
  carbsPerDay: 120,
  mealCount: 21,
  lead: { registered: 10, of: 21 },
};
const input = {
  locale: "da",
  glucoseUnit: "mmol",
  meal: { title: "Example dish", totalCarbs: 30, slot: "lunch", localTime: "12:30" },
  stats,
  previous: [],
  leadLabel: "before",
};
const week = {
  locale: "en",
  glucoseUnit: "mmol",
  isoWeek: 42,
  weekStart: "2026-10-12",
  numbers,
  days: Array.from({ length: 7 }, () => ({
    localDate: "2026-10-12",
    mealCount: 3,
    totalCarbs: 120,
  })),
  meals: [],
};
const photoDataUrl = "data:image/jpeg;base64,/9j/2Q==";
const cases: [keyof typeof ai, z.ZodType, unknown, unknown][] = [
  ["AiProviderId", ai.AiProviderId, "anthropic", "unknown"],
  ["ModelRole", ai.ModelRole, "small", "model-name"],
  ["EstimatedItem", ai.EstimatedItem, item, { ...item, approx: false }],
  ["ParsedItem", ai.ParsedItem, { query: "pasta", estimate: item }, { query: "pasta" }],
  [
    "ParsedMeal",
    ai.ParsedMeal,
    { items: [], unmatched: [] },
    { items: Array(13).fill({ query: "pasta", estimate: item }), unmatched: [] },
  ],
  ["PhotoEstimate", ai.PhotoEstimate, estimate, { ...estimate, approx: false }],
  [
    "NormalisedFood",
    ai.NormalisedFood,
    { name: "Example pasta", portions: [] },
    { name: "", portions: [] },
  ],
  ["InsightStats", ai.InsightStats, stats, { ...stats, ts: "2026-10-15T10:00:00Z" }],
  ["InsightNumbers", ai.InsightNumbers, numbers, { ...numbers, values: [1, 2] }],
  ["InsightInput", ai.InsightInput, input, { ...input, readings: [] }],
  ["WeekInsightInput", ai.WeekInsightInput, week, { ...week, readings: [] }],
  ["MealInsight", ai.MealInsight, { text: "The peak followed the meal." }, { text: "short" }],
  [
    "WeekInsight",
    ai.WeekInsight,
    { summary: "The week contains twenty-one meals.", questions: [] },
    { summary: "short", questions: [] },
  ],
  ["MealInsightView", ai.MealInsightView, { state: "off" }, { state: "other" }],
  [
    "WeekInsightView",
    ai.WeekInsightView,
    { state: "pending", questionsEdited: false, rejectedCount: 0 },
    { state: "ready" },
  ],
  [
    "AiUsage",
    ai.AiUsage,
    {
      enabled: false,
      providers: [],
      callsToday: 0,
      dailyCap: 50,
      embedCallsToday: 0,
      embedDailyCap: 500,
    },
    { enabled: true },
  ],
  ["ParseRequest", ai.ParseRequest, { text: "Two slices" }, { text: "" }],
  [
    "EstimateRequest",
    ai.EstimateRequest,
    { photoDataUrl },
    { photoDataUrl: "https://example.invalid/photo.jpg" },
  ],
  [
    "AskRequest",
    ai.AskRequest,
    { estimate, photoDataUrl },
    { estimate, photoDataUrl: "data:image/png;base64,AA==" },
  ],
  [
    "UpdateInsightRequest",
    ai.UpdateInsightRequest,
    { questions: ["What changed this week?"] },
    { questions: Array(6).fill("What changed this week?") },
  ],
  [
    "PushSubscriptionRequest",
    ai.PushSubscriptionRequest,
    {
      spaceId: "s1",
      subscription: {
        endpoint: "https://example.invalid/push",
        keys: { p256dh: "key", auth: "auth" },
      },
    },
    {
      spaceId: "s1",
      subscription: {
        endpoint: "http://example.invalid/push",
        keys: { p256dh: "key", auth: "auth" },
      },
    },
  ],
  [
    "UpdateSpaceSettingsRequest",
    ai.UpdateSpaceSettingsRequest,
    { aiEnabled: true, aiProvider: "ollama" },
    { aiProvider: "other" },
  ],
  [
    "RecipeParse",
    ai.RecipeParse,
    { title: "Fictional loaf", ingredients: [{ name: "flour", amount: 500, unit: "g" }] },
    {
      title: "Fictional loaf",
      ingredients: Array.from({ length: 41 }, () => ({ name: "flour" })),
    },
  ],
  ["RecipeParseRequest", ai.RecipeParseRequest, { text: "500 g flour" }, { text: "" }],
];

describe("AI contracts", () => {
  it.each(cases)(
    "exports %s, accepts a valid shape and rejects an invalid one",
    (name, schema, valid, invalid) => {
      expect(exported).toHaveProperty(name, schema);
      expect(schema.safeParse(valid).success).toBe(true);
      expect(schema.safeParse(invalid).success).toBe(false);
      if (schema instanceof z.ZodObject)
        expect(schema.safeParse({ ...(valid as object), unexpected: true }).success).toBe(false);
    },
  );
  it("covers every exported schema", () => {
    expect(cases.map(([name]) => name).sort()).toEqual(Object.keys(ai).sort());
  });
  it("requires exactly one matched food or estimate", () => {
    const match = {
      source: "off",
      food: { name: "Example loaf", origin: "off", sourceRef: "off:1", portions: [] },
    };
    expect(ai.ParsedItem.safeParse({ query: "loaf", match }).success).toBe(true);
    expect(ai.ParsedItem.safeParse({ query: "loaf", match, estimate: item }).success).toBe(false);
    expect(ai.ParsedItem.safeParse({ query: "loaf" }).success).toBe(false);
  });
  it("keeps settings writes compatible with the existing owner patch contract", () => {
    expect(ai.UpdateSpaceSettingsRequest.safeParse({}).success).toBe(false);
    expect(ai.UpdateSpaceSettingsRequest.safeParse({ targetLow: 4.01 }).success).toBe(false);
    expect(ai.UpdateSpaceSettingsRequest.safeParse({ name: "Other name" }).success).toBe(false);
    expect(ai.UpdateSpaceSettingsRequest.safeParse({ timezone: "UTC" }).success).toBe(false);
    expect(
      ai.UpdateSpaceSettingsRequest.safeParse({ targetLow: 4.1, targetHigh: 10 }).success,
    ).toBe(true);
  });
  it("has no prohibited key parts or enum values anywhere in the contracts", () => {
    const forbidden =
      /^(insulin|dose|dosing|ratio|correction|bolus|icr|isf|suggest|advice|recommend)$/i;
    expect(
      schemaVocabulary(ai).filter(([, key]) =>
        key
          .replace(/([a-z])([A-Z])/g, "$1 $2")
          .split(/[^a-z]+/i)
          .some((part) => forbidden.test(part)),
      ),
    ).toEqual([]);
  });
  it("keeps aggregate inputs free of series at runtime and in their inferred types", () => {
    expect(ai.InsightInput.safeParse({ ...input, stats: { ...stats, readings: [] } }).success).toBe(
      false,
    );
    expect(
      ai.WeekInsightInput.safeParse({ ...week, numbers: { ...numbers, readings: [] } }).success,
    ).toBe(false);
    expectTypeOf<ai.InsightStats>().toHaveProperty("leadMinutes");
    expectTypeOf<ai.InsightNumbers>().toHaveProperty("lead");
    expectTypeOf<ai.InsightStats>().not.toHaveProperty("ts");
    expectTypeOf<ai.InsightInput>().not.toHaveProperty("readings");
    expectTypeOf<ai.WeekInsightInput>().not.toHaveProperty("readings");
    type HasNumberArray<T> = T extends readonly (infer E)[]
      ? E extends number
        ? true
        : HasNumberArray<E>
      : T extends object
        ? { [K in keyof T]: HasNumberArray<T[K]> }[keyof T]
        : false;
    expectTypeOf<
      true extends HasNumberArray<ai.InsightInput | ai.WeekInsightInput> ? true : false
    >().toEqualTypeOf<false>();
  });
  it("keeps usage free of glucose, endpoint and secret keys", () => {
    const forbidden = /^(mmol|mgdl|trend|reading|readings|glucose|endpoint|secret|key)$/i;
    expect(
      schemaVocabulary({ usage: ai.AiUsage }).filter(([, key]) => forbidden.test(key)),
    ).toEqual([]);
  });
});

describe("recipes and symptoms in the AI contracts (v0.6.0 plan §4)", () => {
  it("parses a recipe as text, a URL or a photo, one way at a time", () => {
    expect(ai.RecipeParseRequest.parse({ url: "https://example.invalid/r" })).toEqual({
      url: "https://example.invalid/r",
    });
    expect(ai.RecipeParseRequest.parse({ photoDataUrl })).toEqual({ photoDataUrl });
    expect(ai.RecipeParseRequest.safeParse({ url: "http://example.invalid/r" }).success).toBe(false);
    expect(ai.RecipeParseRequest.safeParse({ text: "x", url: "https://e.invalid" }).success).toBe(
      false,
    );
    expect(ai.RecipeParseRequest.safeParse({ text: "x".repeat(4001) }).success).toBe(false);
    expect(ai.RecipeParseRequest.safeParse({}).success).toBe(false);
    const parse = {
      title: "Fictional loaf",
      ingredients: [{ name: "flour", amount: 500, unit: "g" }, { name: "water" }],
      yieldPortions: 4,
      yieldGrams: 900,
    };
    expect(ai.RecipeParse.parse(parse)).toEqual(parse);
    expect(ai.RecipeParse.safeParse({ ...parse, title: "x".repeat(121) }).success).toBe(false);
    expect(ai.RecipeParse.safeParse({ ...parse, ingredients: [{ carbs: 3 }] }).success).toBe(
      false,
    );
  });
  it("lets the parser return symptoms and the insight inputs carry kinds and counts only", () => {
    const meal = { items: [], unmatched: [] };
    expect(ai.ParsedMeal.parse(meal)).toEqual(meal);
    expect(
      ai.ParsedMeal.parse({ ...meal, symptoms: [{ kind: "stomach-ache", note: "a bit" }] })
        .symptoms,
    ).toEqual([{ kind: "stomach-ache", note: "a bit" }]);
    expect(ai.ParsedMeal.safeParse({ ...meal, symptoms: [{ kind: "sad" }] }).success).toBe(false);
    expect(
      ai.InsightInput.parse({ ...input, symptoms: [{ kind: "dizzy", minutesAfterMeal: 90 }] })
        .symptoms,
    ).toEqual([{ kind: "dizzy", minutesAfterMeal: 90 }]);
    expect(
      ai.InsightInput.safeParse({
        ...input,
        symptoms: [{ kind: "dizzy", minutesAfterMeal: 90, note: "x" }],
      }).success,
    ).toBe(false);
    expect(
      ai.InsightInput.safeParse({ ...input, symptoms: [{ kind: "dizzy", minutesAfterMeal: 90, mmol: 6 }] })
        .success,
    ).toBe(false);
    expect(
      ai.WeekInsightInput.parse({ ...week, symptomCounts: [{ kind: "tired", count: 2 }] })
        .symptomCounts,
    ).toEqual([{ kind: "tired", count: 2 }]);
    expect(
      ai.WeekInsightInput.safeParse({ ...week, symptomCounts: [{ kind: "tired", count: 2, note: "x" }] })
        .success,
    ).toBe(false);
  });
});

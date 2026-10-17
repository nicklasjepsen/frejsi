import { expect, it } from "vitest";
import { scoreParse, scoreRecipe, checkStrings, checkInsight, enforceThresholds } from "./score";
import { ParsedMeal } from "@frejsi/shared/schemas/ai";

const meal = ParsedMeal.parse({
  items: [
    {
      query: "apple",
      estimate: { name: "ÆBLE med skræl", carbs: 14, confidence: "low", approx: true },
    },
    {
      query: "bread",
      match: {
        source: "cache",
        food: {
          name: "Rugbrød",
          origin: "off",
          sourceRef: "fictional",
          carbsPer100g: 40,
          portions: [{ label: "1 skive", carbs: 18 }],
        },
        grams: 90,
      },
    },
  ],
  unmatched: ["ukendt"],
});
it("folds names, consumes matches once, computes carbs from grams or portions and includes misses", () => {
  expect(
    scoreParse(
      [
        { name: "aeble", carbs: 14 },
        { name: "rugbrod", carbs: 36 },
        { name: "aeble", carbs: 14 },
      ],
      [],
      meal,
    ),
  ).toEqual({ expected: 3, found: 2, portions: 2, unmatched: 0, expectedUnmatched: 0 });
  expect(scoreParse([], ["ukendt"], meal).unmatched).toBe(1);
  const bread = meal.items[1];
  if (!bread?.match) throw new Error("missing bread fixture");
  expect(
    scoreParse([{ name: "rugbrod", carbs: 18 }], [], {
      items: [
        {
          ...bread,
          match: { ...bread.match, grams: 45, portionLabel: "1 skive" },
        },
      ],
      unmatched: [],
    }).portions,
  ).toBe(1);
});
it("uses inclusive tolerances and handles zero carbs without dividing by zero", () => {
  for (const carbs of [11.2, 18.666666666666668])
    expect(scoreParse([{ name: "aeble", carbs }], [], meal).portions).toBe(1);
  expect(scoreParse([{ name: "aeble", carbs: 0 }], [], meal).portions).toBe(0);
});
it("guards nested strings and observational insight numbers in either decimal notation", () => {
  expect(() => {
    checkStrings({ nested: [{ text: "should" }] });
  }).toThrow();
  expect(() => {
    checkInsight({ text: "Toppen var 9,6 efter 60 minutter." }, { peak: 9.6, minutes: 60 });
  }).not.toThrow();
  for (const text of [
    "Toppen var 99 efter måltidet.",
    "Trykket var før måltidet.",
    "Registreringen var før måltidet.",
    "Registreringens tidspunkt var før måltidet.",
    "Næste gang er anderledes.",
  ])
    expect(() => {
      checkInsight({ text }, { peak: 9.6 });
    }).toThrow();
});
it("fails below fixed thresholds and only enforces photo accuracy at twenty evaluated images", () => {
  const scores = {
    parseRecall: 0.8,
    parsePortions: 0.6,
    photoAccuracy: 0,
    photoCount: 19,
    normaliseAccuracy: 1,
    unmatchedAccuracy: 1,
    recipeAccuracy: 0.8,
    recipeCount: 5,
  };
  expect(() => {
    enforceThresholds(scores);
  }).not.toThrow();
  expect(() => {
    enforceThresholds({ ...scores, recipeAccuracy: 0.79 });
  }).toThrow("recipeAccuracy");
  expect(() => {
    enforceThresholds({ ...scores, recipeAccuracy: 0, recipeCount: 0 });
  }).not.toThrow();
  expect(() => {
    enforceThresholds({ ...scores, parseRecall: 0.79 });
  }).toThrow();
  expect(() => {
    enforceThresholds({ ...scores, photoCount: 20 });
  }).toThrow();
  expect(() => {
    enforceThresholds({ ...scores, photoCount: 10 }, 20);
  }).toThrow();
});
it("scores a recipe on its line count and carbs per portion within the tolerance", () => {
  const expected = { ingredients: 6, carbsPerPortion: 33 };
  expect(scoreRecipe(expected, { ingredients: 6, carbsPerPortion: 33 })).toBe(true);
  expect(scoreRecipe(expected, { ingredients: 6, carbsPerPortion: 42 })).toBe(true);
  expect(scoreRecipe(expected, { ingredients: 6, carbsPerPortion: 44 })).toBe(false);
  expect(scoreRecipe(expected, { ingredients: 5, carbsPerPortion: 33 })).toBe(false);
  expect(scoreRecipe(expected, { ingredients: 6, carbsPerPortion: undefined })).toBe(false);
  expect(
    scoreRecipe({ ingredients: 2, carbsPerPortion: 0 }, { ingredients: 2, carbsPerPortion: 1 }),
  ).toBe(false);
});

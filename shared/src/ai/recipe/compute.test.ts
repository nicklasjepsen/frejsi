import { describe, expect, it } from "vitest";
import { computeRecipe } from "./compute";

const labels = { one: "1 portion", half: "½ portion" };

describe("computeRecipe (carbs per 100 g from the total and the yield; the two named portions)", () => {
  it("divides the total by yieldGrams, and by the sum of line grams when only portions are given", () => {
    const lines = [
      { grams: 500, carbs: 0 },
      { grams: 250, carbs: 175 },
      { grams: 500, carbs: 24 },
      { carbs: 24 },
    ];
    expect(computeRecipe(lines, { yieldGrams: 2000, yieldPortions: 6 }, labels)).toEqual({
      totalCarbs: 223,
      baseGrams: 2000,
      carbsPer100g: 11.2,
      portions: [
        { label: "1 portion", grams: 333, carbs: 37 },
        { label: "½ portion", grams: 167, carbs: 19 },
      ],
    });
    expect(computeRecipe(lines, { yieldPortions: 5 }, labels)).toEqual({
      totalCarbs: 223,
      baseGrams: 1250,
      carbsPer100g: 17.8,
      portions: [
        { label: "1 portion", grams: 250, carbs: 45 },
        { label: "½ portion", grams: 125, carbs: 22 },
      ],
    });
  });
  it("gives no carbs per 100 g when no line has grams, and no portions without a portion count", () => {
    expect(computeRecipe([{ carbs: 30 }, { carbs: 12 }], { yieldPortions: 2 }, labels)).toEqual({
      totalCarbs: 42,
      portions: [
        { label: "1 portion", carbs: 21 },
        { label: "½ portion", carbs: 11 },
      ],
    });
    expect(computeRecipe([{ grams: 400, carbs: 100 }], { yieldGrams: 800 }, labels)).toEqual({
      totalCarbs: 100,
      baseGrams: 800,
      carbsPer100g: 12.5,
      portions: [],
    });
  });
  it("keeps the numbers inside the food contract: per 100 g at most 100, portion grams 1 to 5000", () => {
    expect(
      computeRecipe([{ grams: 10, carbs: 50 }], { yieldGrams: 10, yieldPortions: 1 }, labels),
    ).toEqual({
      totalCarbs: 50,
      baseGrams: 10,
      portions: [
        { label: "1 portion", grams: 10, carbs: 50 },
        { label: "½ portion", grams: 5, carbs: 25 },
      ],
    });
    const huge = computeRecipe([{ grams: 20_000, carbs: 1000 }], { yieldPortions: 2 }, labels);
    expect(huge.portions[0]).toEqual({ label: "1 portion", carbs: 500 });
    const tiny = computeRecipe([{ grams: 1, carbs: 1 }], { yieldPortions: 4 }, labels);
    expect(tiny.portions).toEqual([
      { label: "1 portion", carbs: 0 },
      { label: "½ portion", carbs: 0 },
    ]);
  });
});

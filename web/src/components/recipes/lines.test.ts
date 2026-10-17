import type { FoodView, RecipeReview } from "@frejsi/shared/schemas/food";
import { describe, expect, it } from "vitest";
import { linesFrom, linesFromIngredients, toIngredients, withAmount } from "./lines";

const flour: FoodView = {
  id: "f-flour",
  name: "Hvedemel",
  carbsPer100g: 72,
  portions: [],
  origin: "family",
  verified: true,
  favourite: false,
  createdAt: "2026-10-14T10:00:00.000Z",
  updatedAt: "2026-10-14T10:00:00.000Z",
};

describe("the review form's lines", () => {
  it("keeps the matched food so an edited amount recomputes exactly as the route would", () => {
    const review: RecipeReview = {
      title: "x",
      approx: true,
      totalCarbs: 432,
      source: { kind: "text" },
      lines: [
        {
          name: "mel",
          amount: 600,
          unit: "g",
          grams: 600,
          foodId: "f-flour",
          foodName: "Hvedemel",
          carbs: 432,
          match: flour,
        },
      ],
    };
    const [line] = linesFrom(review);
    if (!line) throw new Error("no line");
    expect(line.approx).toBe(true);
    const edited = withAmount(line, 300, "g");
    expect(edited).toMatchObject({ grams: 300, carbs: 216, foodId: "f-flour", approx: false });
    expect(toIngredients([edited])).toEqual([
      {
        name: "mel",
        amount: 300,
        unit: "g",
        grams: 300,
        foodId: "f-flour",
        foodName: "Hvedemel",
        carbs: 216,
      },
    ]);
  });
  it("scales a saved line's snapshot when the food behind it is not at hand, never to zero", () => {
    const [weighed, counted, bare] = linesFromIngredients([
      { name: "mel", amount: 600, unit: "g", grams: 600, foodName: "Hvedemel, Fiktiv", carbs: 432 },
      { name: "boller", amount: 2, unit: "stk", grams: 120, foodName: "Bolle", carbs: 60 },
      { name: "tomater", amount: 2, unit: "dåse", foodName: "Flåede tomater", carbs: 24 },
    ]);
    if (!weighed || !counted || !bare) throw new Error("no lines");
    expect(withAmount(weighed, 300, "g")).toMatchObject({
      amount: 300,
      grams: 300,
      carbs: 216,
      foodName: "Hvedemel, Fiktiv",
    });
    expect(withAmount(weighed, 1.2, "kg")).toMatchObject({
      amount: 1.2,
      unit: "kg",
      grams: 1200,
      carbs: 864,
    });
    expect(withAmount(counted, 3, "stk")).toMatchObject({ amount: 3, grams: 180, carbs: 90 });
    expect(withAmount(bare, 1, "dåse")).toMatchObject({ amount: 1, carbs: 12 });
    expect(withAmount(bare, 1, "dåse").grams).toBeUndefined();
    // Without a way to scale (no amount before), the carbs stand as they were.
    expect(withAmount({ ...bare, amount: undefined }, 3, undefined)).toMatchObject({
      amount: 3,
      carbs: 24,
    });
    // A staple or an unmatched line goes through the shared rule as before.
    const [salt, mystery] = linesFromIngredients([
      { name: "salt", carbs: 0, noCarb: true },
      { name: "mystery", amount: 1, carbs: 0 },
    ]);
    if (!salt || !mystery) throw new Error("no lines");
    expect(withAmount(salt, 2, "tsk")).toMatchObject({ grams: 10, carbs: 0, noCarb: true });
    expect(withAmount(mystery, 100, "g")).toMatchObject({ grams: 100, carbs: 0 });
  });
});

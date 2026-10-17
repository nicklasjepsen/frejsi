import { describe, expect, it, vi } from "vitest";
import type { FoodCandidate, FoodView, LookupResponse } from "../../schemas/food";
import { NO_CARB_STAPLES, gramsFor, isNoCarbStaple, lineFor, resolveIngredients } from "./ingredients";

const library = (name: string, extra: Partial<FoodView> = {}): FoodView => ({
  id: `lib-${name}`,
  name,
  origin: "family",
  verified: true,
  favourite: false,
  portions: [],
  createdAt: "2026-10-14T10:00:00.000Z",
  updatedAt: "2026-10-14T10:00:00.000Z",
  ...extra,
});
const candidate = (name: string, extra: Partial<FoodCandidate> = {}): FoodCandidate => ({
  name,
  origin: "off",
  sourceRef: `off:${name}`,
  portions: [],
  ...extra,
});
const answer = (results: LookupResponse["results"]): LookupResponse => ({
  results,
  sources: {},
  manual: {},
});

describe("NO_CARB_STAPLES", () => {
  it("names water, salt, pepper, oil, butter and their English forms, and matches around fillers", () => {
    for (const name of ["vand", "salt", "peber", "olie", "smør", "water", "eddike", "vinegar"])
      expect(NO_CARB_STAPLES.has(name), name).toBe(true);
    for (const name of [
      "Salt",
      "salt og peber",
      "lidt salt",
      "frisk basilikum",
      "2 spsk olivenolie",
      "Olive oil",
      "salt and pepper",
      "kogende vand",
      "friskkværnet peber",
    ])
      expect(isNoCarbStaple(name), name).toBe(true);
    for (const name of ["hakket oksekød", "mælk", "løg", "sukker", "hvidløg", "sojasauce med sukker"])
      expect(isNoCarbStaple(name), name).toBe(false);
  });
});

describe("gramsFor (decision 12: a small unit table, stk from the food's first portion)", () => {
  it("converts g, kg, dl, l, ml, spsk and tsk, and stk through the matched food's portion", () => {
    expect(gramsFor(500, "g")).toBe(500);
    expect(gramsFor(1.5, "kg")).toBe(1500);
    expect(gramsFor(5, "dl")).toBe(500);
    expect(gramsFor(0.5, "l")).toBe(500);
    expect(gramsFor(200, "ml")).toBe(200);
    expect(gramsFor(2, "spsk")).toBe(30);
    expect(gramsFor(1, "tsk")).toBe(5);
    expect(gramsFor(2, "tbsp")).toBe(30);
    const egg = library("Æg", { portions: [{ label: "1 stk", grams: 55, carbs: 0 }] });
    expect(gramsFor(2, "stk", egg)).toBe(110);
    expect(gramsFor(2, undefined, egg)).toBe(110);
    expect(gramsFor(2, "stk")).toBeUndefined();
    expect(gramsFor(2, "dåse")).toBeUndefined();
    expect(gramsFor(undefined, "g")).toBeUndefined();
    expect(gramsFor(1, "unknownunit", egg)).toBeUndefined();
  });
});

describe("lineFor (one reviewed line from a parsed line and its match)", () => {
  it("weighs a per-100 g food, counts a portioned one, and gives a staple or an unmatched line 0", () => {
    const flour = library("Hvedemel", { carbsPer100g: 72 });
    expect(lineFor({ name: "hvedemel", amount: 600, unit: "g" }, flour)).toEqual({
      name: "hvedemel",
      amount: 600,
      unit: "g",
      grams: 600,
      foodId: "lib-Hvedemel",
      foodName: "Hvedemel",
      carbs: 432,
    });
    const milk = library("Mælk", { carbsPer100g: 4.8 });
    expect(lineFor({ name: "mælk", amount: 5, unit: "dl" }, milk)).toMatchObject({ grams: 500, carbs: 24 });
    const bun = candidate("Bolle", { portions: [{ label: "1 stk", grams: 60, carbs: 30 }] });
    expect(lineFor({ name: "boller", amount: 2, unit: "stk" }, bun)).toEqual({
      name: "boller",
      amount: 2,
      unit: "stk",
      grams: 120,
      foodName: "Bolle",
      carbs: 60,
    });
    const onion = library("Løg", { carbsPer100g: 7, portions: [{ label: "1 stk", grams: 100, carbs: 7 }] });
    expect(lineFor({ name: "løg" }, onion)).toMatchObject({ grams: 100, carbs: 7, foodId: "lib-Løg" });
    const tomatoes = library("Flåede tomater", { portions: [{ label: "1 dåse", carbs: 12 }] });
    expect(lineFor({ name: "flåede tomater", amount: 2, unit: "dåse" }, tomatoes)).toMatchObject({ carbs: 24 });
    expect(lineFor({ name: "flåede tomater", amount: 2, unit: "dåse" }, tomatoes).grams).toBeUndefined();
    expect(lineFor({ name: "salt", amount: 1, unit: "tsk" }, null)).toEqual({
      name: "salt",
      amount: 1,
      unit: "tsk",
      grams: 5,
      carbs: 0,
      noCarb: true,
    });
    expect(lineFor({ name: "mystery", amount: 100, unit: "g" }, null)).toEqual({
      name: "mystery",
      amount: 100,
      unit: "g",
      grams: 100,
      carbs: 0,
    });
    // A per-100 g food with a count and no portion grams: the count cannot be weighed, carbs stay 0.
    expect(lineFor({ name: "x", amount: 2, unit: "stk" }, flour)).toMatchObject({ carbs: 0, foodId: "lib-Hvedemel" });
  });
});

describe("resolveIngredients (lookup() once per line, staples without a lookup)", () => {
  const lines = [
    { name: "hakket oksekød", amount: 500, unit: "g" },
    { name: "salt og peber" },
    { name: "lasagneplader", amount: 250, unit: "g" },
    { name: "vand", amount: 2, unit: "dl" },
    { name: "ukendt ting", amount: 1 },
  ];
  const beef = library("Hakket oksekød", { carbsPer100g: 0 });
  const pasta = candidate("Lasagneplader, Fiktiv", { carbsPer100g: 70 });
  const otherPasta = candidate("Lasagne, Anden", { carbsPer100g: 68, origin: "frida", sourceRef: "frida:1" });
  it("looks every non-staple line up once in order, takes the library match, else the first candidate", async () => {
    const lookup = vi.fn((q: string) =>
      Promise.resolve(
        q === "hakket oksekød"
          ? answer([
              { source: "off", verified: false, food: candidate("Oksekød fra kilde") },
              { source: "library", verified: true, food: beef },
            ])
          : q === "lasagneplader"
            ? answer([
                { source: "off", verified: false, food: pasta },
                { source: "frida", verified: false, food: otherPasta },
              ])
            : answer([]),
      ),
    );
    const resolved = await resolveIngredients(lines, lookup);
    expect(lookup.mock.calls.map(([q]) => q)).toEqual(["hakket oksekød", "lasagneplader", "ukendt ting"]);
    expect(resolved).toHaveLength(5);
    expect(resolved[0]).toMatchObject({ foodId: beef.id, foodName: beef.name, carbs: 0, grams: 500, match: beef });
    expect(resolved[0]?.candidates?.map((c) => c.name)).toEqual(["Oksekød fra kilde"]);
    expect(resolved[1]).toEqual({ name: "salt og peber", carbs: 0, noCarb: true });
    expect(resolved[2]).toMatchObject({ foodName: pasta.name, carbs: 175, grams: 250 });
    expect(resolved[2]?.foodId).toBeUndefined();
    expect(resolved[2]?.match).toBeUndefined();
    expect(resolved[2]?.candidates?.map((c) => c.name)).toEqual([pasta.name, otherPasta.name]);
    expect(resolved[3]).toEqual({ name: "vand", amount: 2, unit: "dl", grams: 200, carbs: 0, noCarb: true });
    expect(resolved[4]).toEqual({ name: "ukendt ting", amount: 1, carbs: 0 });
  });
  it("searches the first 80 characters of a long name and survives a lookup that fails", async () => {
    const lookup = vi.fn((q: string) =>
      q.length > 80 ? Promise.reject(new Error("too long")) : Promise.reject(new Error("down")),
    );
    const resolved = await resolveIngredients([{ name: "x".repeat(120), amount: 1, unit: "g" }], lookup);
    expect(lookup.mock.calls[0]?.[0]).toHaveLength(80);
    expect(resolved[0]).toEqual({ name: "x".repeat(120), amount: 1, unit: "g", grams: 1, carbs: 0 });
  });
});

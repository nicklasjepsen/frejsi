import type { FoodView } from "@frejsi/shared/schemas/food";
import type { MealView } from "@frejsi/shared/schemas/meal";
import { describe, expect, it } from "vitest";

import {
  addFood,
  chooseEatingIn,
  chooseGrams,
  choosePortion,
  clearChoice,
  DEFAULT_EATING_IN,
  draftFromMeal,
  EATING_IN_CHOICES,
  emptyDraft,
  isComplete,
  itemCarbs,
  knownTotal,
  mealTs,
  relinkFood,
  removeItem,
  setMealTime,
  toMealRequest,
  totalCarbs,
} from "./draft";

// 12:10 in Copenhagen: the moment the meal is saved.
const NOW = new Date("2026-10-14T10:10:00.000Z");

const bread: FoodView = {
  id: "f-bread",
  name: "Fictional rye bread",
  carbsPer100g: 40,
  portions: [
    { label: "half slice", grams: 22.5, carbs: 9 },
    { label: "1 slice", grams: 45, carbs: 18 },
    { label: "2 slices", grams: 90, carbs: 36 },
  ],
  origin: "off",
  verified: false,
  favourite: false,
  createdAt: "2026-10-14T10:00:00.000Z",
  updatedAt: "2026-10-14T10:00:00.000Z",
};
const lunchbox: FoodView = {
  id: "f-box",
  name: "Fictional lunchbox",
  portions: [{ label: "1 box", carbs: 42 }],
  origin: "family",
  verified: true,
  favourite: true,
  createdAt: "2026-10-14T10:00:00.000Z",
  updatedAt: "2026-10-14T10:00:00.000Z",
};
const apple: FoodView = { ...bread, id: "f-apple", name: "Fictional apple", portions: [] };

describe("the meal draft", () => {
  it("adds a food without choosing a portion for the user, except a single-portion dish", () => {
    let draft = addFood(emptyDraft(), bread);
    expect(draft.items[0]?.choice).toBeNull();
    expect(isComplete(draft)).toBe(false);
    draft = addFood(draft, lunchbox);
    expect(draft.items[1]?.choice).toEqual({ portion: 0 });
    expect(totalCarbs(draft)).toBe(42);
  });

  it("sums portions and weighed grams in whole grams", () => {
    let draft = addFood(addFood(emptyDraft(), bread), apple);
    const [first, second] = draft.items;
    draft = choosePortion(draft, first?.key ?? "", 2);
    draft = chooseGrams(draft, second?.key ?? "", 35); // 40 g/100 g × 35 g = 14
    expect(draft.items.map(itemCarbs)).toEqual([36, 14]);
    expect(totalCarbs(draft)).toBe(50);
    expect(isComplete(draft)).toBe(true);
  });

  it("knows no total until every item has a choice, so a bar never shows a fake 0 g", () => {
    expect(knownTotal(emptyDraft())).toBeNull();
    let draft = addFood(addFood(emptyDraft(), bread), lunchbox);
    expect(knownTotal(draft)).toBeNull();
    draft = choosePortion(draft, draft.items[0]?.key ?? "", 2);
    expect(knownTotal(draft)).toBe(totalCarbs(draft));
  });

  it("builds the POST meals body from food ids, portion labels and grams, never an amount of anything else", () => {
    let draft = addFood(addFood(emptyDraft(), bread), apple);
    draft = choosePortion(draft, draft.items[0]?.key ?? "", 1);
    draft = chooseGrams(draft, draft.items[1]?.key ?? "", 35);
    draft = { ...draft, bolusTs: "2026-10-14T09:58:00.000Z" };
    expect(toMealRequest(draft, null, NOW)).toEqual({
      ts: "2026-10-14T10:25:00.000Z",
      items: [
        { foodId: "f-bread", name: "Fictional rye bread", portionLabel: "1 slice", carbs: 18 },
        { foodId: "f-apple", name: "Fictional apple", grams: 35, carbs: 14 },
      ],
      bolusTs: "2026-10-14T09:58:00.000Z",
    });
  });

  it("starts with eating in 15 minutes and stamps the meal that far from the save moment", () => {
    expect(EATING_IN_CHOICES).toEqual([0, 5, 10, 15, 20]);
    expect(DEFAULT_EATING_IN).toBe(15);
    const draft = emptyDraft();
    expect(draft.eatingIn).toBe(15);
    expect(draft.ts).toBeNull();
    expect(mealTs(draft, NOW)).toBe("2026-10-14T10:25:00.000Z");
    // Resolved when saving, not when the chips were drawn.
    const later = new Date(NOW.getTime() + 7 * 60_000);
    expect(mealTs(draft, later)).toBe("2026-10-14T10:32:00.000Z");
    expect(toMealRequest(addFood(draft, lunchbox), null, later).ts).toBe(
      "2026-10-14T10:32:00.000Z",
    );
  });

  it("sends no time for 'nu', so the server stamps the save moment as before", () => {
    const draft = chooseEatingIn(addFood(emptyDraft(), lunchbox), 0);
    expect(draft.eatingIn).toBe(0);
    expect(mealTs(draft, NOW)).toBeNull();
    expect(toMealRequest(draft, null, NOW)).not.toHaveProperty("ts");
    expect(mealTs(chooseEatingIn(draft, 5), NOW)).toBe("2026-10-14T10:15:00.000Z");
  });

  it("lets a time set by hand win over the chips and deselects them", () => {
    let draft = chooseEatingIn(emptyDraft(), 20);
    draft = setMealTime(draft, "2026-10-14T11:00:00.000Z");
    expect(draft.eatingIn).toBeNull();
    expect(mealTs(draft, NOW)).toBe("2026-10-14T11:00:00.000Z");
    expect(toMealRequest(draft, null, NOW).ts).toBe("2026-10-14T11:00:00.000Z");
    // A chip after that replaces the hand-set time again.
    draft = chooseEatingIn(draft, 10);
    expect(draft.ts).toBeNull();
    expect(mealTs(draft, NOW)).toBe("2026-10-14T10:20:00.000Z");
  });

  it("removes an item", () => {
    const draft = addFood(addFood(emptyDraft(), bread), lunchbox);
    expect(removeItem(draft, draft.items[0]?.key ?? "").items.map((i) => i.name)).toEqual([
      "Fictional lunchbox",
    ]);
  });

  it("reopens a saved meal from its snapshot and sends the snapshot back unchanged", () => {
    const meal: MealView = {
      id: "m1",
      ts: "2026-10-14T10:10:00.000Z",
      title: "x",
      slot: "lunch",
      totalCarbs: 50,
      byUser: { id: "u1", name: "Jonas" },
      items: [
        { name: "Fictional rye bread", portionLabel: "2 slices", carbs: 36 },
        { name: "Fictional apple", grams: 35, carbs: 14 },
      ],
      bolusTs: "2026-10-14T09:58:00.000Z",
    };
    const draft = draftFromMeal(meal);
    expect(totalCarbs(draft)).toBe(50);
    expect(draft.ts).toBe(meal.ts);
    // A saved meal keeps its stored time: no chip is preselected.
    expect(draft.eatingIn).toBeNull();
    expect(mealTs(draft, NOW)).toBe(meal.ts);
    expect(draft.bolusTs).toBe(meal.bolusTs);
    expect(toMealRequest(draft, "photo", NOW)).toEqual({
      ts: meal.ts,
      items: [
        { name: "Fictional rye bread", portionLabel: "2 slices", carbs: 36 },
        { name: "Fictional apple", grams: 35, carbs: 14 },
      ],
      bolusTs: meal.bolusTs,
      photoDataUrl: "photo",
    });
  });

  it("sends a cleared bolus tap on an edit as no bolusTs", () => {
    const draft = { ...addFood(emptyDraft(), lunchbox), bolusTs: null };
    expect(toMealRequest(draft, null)).not.toHaveProperty("bolusTs");
  });

  it("is incomplete again when a weighed quantity is cleared", () => {
    let draft = addFood(emptyDraft(), apple);
    const key = draft.items[0]?.key ?? "";
    draft = chooseGrams(draft, key, 35);
    expect(isComplete(draft)).toBe(true);
    draft = clearChoice(draft, key);
    expect(isComplete(draft)).toBe(false);
    expect(totalCarbs(draft)).toBe(0);
  });

  it("relinks a reopened item to its food and keeps the snapshot until a portion is changed", () => {
    const meal: MealView = {
      id: "m1",
      ts: "2026-10-14T10:10:00.000Z",
      title: "x",
      slot: "lunch",
      totalCarbs: 36,
      byUser: { id: "u1", name: "Jonas" },
      items: [{ name: "Fictional rye bread", portionLabel: "2 slices", carbs: 35 }],
    };
    let draft = relinkFood(draftFromMeal(meal), "s1", bread);
    expect(draft.items[0]?.choice).toEqual({ portion: 2 });
    // The stored 35 g stays what is saved, although the food says 36 g today.
    expect(totalCarbs(draft)).toBe(35);
    expect(toMealRequest(draft, null).items).toEqual([
      { name: "Fictional rye bread", portionLabel: "2 slices", carbs: 35 },
    ]);
    draft = choosePortion(draft, "s1", 1);
    expect(totalCarbs(draft)).toBe(18);
    expect(toMealRequest(draft, null).items).toEqual([
      { foodId: "f-bread", name: "Fictional rye bread", portionLabel: "1 slice", carbs: 18 },
    ]);
  });
});

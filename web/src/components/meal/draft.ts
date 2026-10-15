// The meal being built on the log screen: pure functions over a plain value, so the phone and
// desktop layouts share one model and the arithmetic is tested without a browser. Carbs are whole
// grams through `carbsFor` (decision 25); the server recomputes them from the food and ignores the
// client's number whenever it can (plan §4, `MealItemInput`).
import { carbsFor } from "@frejsi/shared/food/portions";
import type { FoodView } from "@frejsi/shared/schemas/food";
import type { CreateMealRequest, MealItemInput, MealView } from "@frejsi/shared/schemas/meal";

export type Choice = { portion: number } | { grams: number };

export interface DraftItem {
  key: string;
  name: string;
  /** The library food, when the item came from a pick; null for a reopened snapshot. */
  food: FoodView | null;
  choice: Choice | null;
  /** A reopened meal's stored item: name, portion and carbs as they were (§2 snapshot rule). */
  snapshot?: { portionLabel?: string; grams?: number; carbs: number };
}

export interface MealDraft {
  items: DraftItem[];
  /** ISO time of the meal; null means "now" at save. */
  ts: string | null;
  /** The "Bolus givet nu" tap: a time and nothing else. */
  bolusTs: string | null;
  nextKey: number;
}

export const emptyDraft = (): MealDraft => ({ items: [], ts: null, bolusTs: null, nextKey: 1 });

export function addFood(draft: MealDraft, food: FoodView): MealDraft {
  const single = food.carbsPer100g == null && food.portions.length === 1;
  const item: DraftItem = {
    key: `i${draft.nextKey}`,
    name: food.name,
    food,
    choice: single ? { portion: 0 } : null,
  };
  return { ...draft, items: [...draft.items, item], nextKey: draft.nextKey + 1 };
}

const update = (draft: MealDraft, key: string, choice: Choice): MealDraft => ({
  ...draft,
  items: draft.items.map((item) => (item.key === key ? { ...item, choice } : item)),
});

export const choosePortion = (draft: MealDraft, key: string, portion: number) =>
  update(draft, key, { portion });

export const chooseGrams = (draft: MealDraft, key: string, grams: number) =>
  update(draft, key, { grams });

export const removeItem = (draft: MealDraft, key: string): MealDraft => ({
  ...draft,
  items: draft.items.filter((item) => item.key !== key),
});

/** The item's carbs, or null while no portion is chosen. */
export function itemCarbs(item: DraftItem): number | null {
  if (item.snapshot) return item.snapshot.carbs;
  if (!item.food || !item.choice) return null;
  if ("portion" in item.choice) {
    const portion = item.food.portions[item.choice.portion];
    return portion ? carbsFor(item.food, portion) : null;
  }
  return item.food.carbsPer100g == null ? null : carbsFor(item.food, item.choice.grams);
}

export function portionLabel(item: DraftItem): string | undefined {
  if (item.snapshot) return item.snapshot.portionLabel;
  if (item.food && item.choice && "portion" in item.choice) {
    return item.food.portions[item.choice.portion]?.label;
  }
  return undefined;
}

export function itemGrams(item: DraftItem): number | undefined {
  if (item.snapshot) return item.snapshot.grams;
  return item.choice && "grams" in item.choice ? item.choice.grams : undefined;
}

export const totalCarbs = (draft: MealDraft): number =>
  draft.items.reduce((sum, item) => sum + (itemCarbs(item) ?? 0), 0);

export const isComplete = (draft: MealDraft): boolean =>
  draft.items.length > 0 && draft.items.every((item) => itemCarbs(item) !== null);

function toItemInput(item: DraftItem): MealItemInput {
  const carbs = itemCarbs(item) ?? 0;
  const label = portionLabel(item);
  const grams = itemGrams(item);
  return {
    ...(item.food ? { foodId: item.food.id } : {}),
    name: item.name,
    ...(label !== undefined ? { portionLabel: label } : {}),
    ...(grams !== undefined ? { grams } : {}),
    carbs,
  };
}

/** The body for `POST meals` (and `PATCH meals/[id]`, where `items` replaces the stored ones). */
export function toMealRequest(draft: MealDraft, photoDataUrl: string | null): CreateMealRequest {
  return {
    ...(draft.ts ? { ts: draft.ts } : {}),
    items: draft.items.map(toItemInput),
    ...(draft.bolusTs ? { bolusTs: draft.bolusTs } : {}),
    ...(photoDataUrl ? { photoDataUrl } : {}),
  };
}

/** A saved meal back in the confirm screen (`?meal=<id>`), its items as stored snapshots. */
export function draftFromMeal(meal: MealView): MealDraft {
  return {
    items: meal.items.map((item, index) => ({
      key: `s${index + 1}`,
      name: item.name,
      food: null,
      choice: null,
      snapshot: {
        carbs: item.carbs,
        ...(item.portionLabel !== undefined ? { portionLabel: item.portionLabel } : {}),
        ...(item.grams !== undefined ? { grams: item.grams } : {}),
      },
    })),
    ts: meal.ts,
    bolusTs: meal.bolusTs ?? null,
    nextKey: 1,
  };
}

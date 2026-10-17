// What the picker (`eat`, Log-Simpel) reads and writes, built on the log screen's client so both
// screens speak to the routes the same way. The list comes from `GET foods` only: for a simpleMode
// session the route itself returns verified foods only (plan §11 decision 12), and the picker
// keeps only verified foods for every session, so no client state can widen it (spec §2).
import { carbsFor } from "@frejsi/shared/food/portions";
import type { FoodView } from "@frejsi/shared/schemas/food";

import { createMeal, listFoods } from "@/components/meal/api";
import { eatingInTs, type EatingIn } from "@/components/meal/draft";

/**
 * A food the picker can offer: ticked by an adult, with at least one portion. A food with only a
 * per-100 g value would have to be weighed, which the simple screens do not ask of anyone.
 */
export const pickable = (food: FoodView): boolean => food.verified && food.portions.length > 0;

/** The space's verified foods, recently eaten first, then the rest in the library's order. */
export async function loadPickerFoods(spaceId: string): Promise<FoodView[]> {
  const [recent, all] = await Promise.all([
    listFoods(spaceId, "recent"),
    listFoods(spaceId, "all"),
  ]);
  const seen = new Set<string>();
  const foods: FoodView[] = [];
  for (const food of [...recent, ...all]) {
    if (seen.has(food.id) || !pickable(food)) continue;
    seen.add(food.id);
    foods.push(food);
  }
  return foods;
}

/** The carbs of one portion, in whole grams as the server will compute them. */
export function portionCarbs(food: FoodView, index: number): number | null {
  const portion = food.portions[index];
  return portion ? carbsFor(food, portion) : null;
}

/**
 * "Ja, det spiser jeg": one meal of one portion, eating in `eatingIn` minutes from `now` (the save
 * moment; "nu" sends no time and the server stamps it). The body never carries `bolusTs` (the
 * route refuses it from a simpleMode session, and the picker has no bolus control for anyone).
 */
export async function eatNow(
  spaceId: string,
  food: FoodView,
  index: number,
  eatingIn: EatingIn,
  now: Date = new Date(),
): Promise<void> {
  const portion = food.portions[index];
  const carbs = portionCarbs(food, index);
  if (!portion || carbs === null) throw new Error("no portion");
  const ts = eatingInTs(eatingIn, now);
  await createMeal(spaceId, {
    ...(ts ? { ts } : {}),
    items: [{ foodId: food.id, name: food.name, portionLabel: portion.label, carbs }],
  });
}

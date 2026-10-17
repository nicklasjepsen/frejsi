import { MealSymbol, type FoodCategory } from "../schemas/food";

export interface SymbolItem {
  carbs: number;
  category?: FoodCategory | null | undefined;
}

/**
 * The symbol drawn at a meal's marker (v0.6.0 plan §4, decision 2): no items → `unknown`; the
 * item with the most carbs is dominant (the first one when every item is at zero); a dominant
 * item without a category → `unknown`; a dominant item with more than half the carbs → its
 * category; otherwise `mixed`, the plate. Pure: it runs once when the meal is saved, and the
 * result is stored so a later library edit never rewrites a past day.
 */
export function mealSymbol(items: readonly SymbolItem[]): MealSymbol {
  const first = items[0];
  if (!first) return "unknown";
  const total = items.reduce((sum, item) => sum + item.carbs, 0);
  const dominant =
    total === 0 ? first : items.reduce((best, item) => (item.carbs > best.carbs ? item : best));
  if (!dominant.category) return "unknown";
  return total === 0 || dominant.carbs * 2 > total ? dominant.category : "mixed";
}

/** `Meal.symbol` as read from the row: null (before 0005) or a stale value is the apple. */
export function storedSymbol(value: string | null | undefined): MealSymbol {
  const parsed = MealSymbol.safeParse(value);
  return parsed.success ? parsed.data : "unknown";
}

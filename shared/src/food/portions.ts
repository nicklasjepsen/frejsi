import type { Portion } from "../schemas/food";

/** Portion carbs are snapshots; weighing requires a per-100 g value. */
export function carbsFor(
  food: { carbsPer100g?: number | null | undefined },
  amount: number | Portion,
): number {
  if (typeof amount !== "number") return amount.carbs;
  if (food.carbsPer100g == null) throw new Error("A weighed food needs carbsPer100g");
  if (
    !Number.isFinite(amount) ||
    amount < 0 ||
    !Number.isFinite(food.carbsPer100g) ||
    food.carbsPer100g < 0
  )
    throw new Error("Invalid weighed food");
  // The contract stores tenths. Multiply those integers first so e.g. 1.4 × 2750
  // cannot become 38.49999999999999 before half-up rounding.
  return Math.floor((Math.round(food.carbsPer100g * 10) * amount) / 1000 + 0.5);
}

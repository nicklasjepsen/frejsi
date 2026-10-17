import { type Reading } from "../schemas/glucose";
import { type InRange, type MealStats, type Target } from "../schemas/history";
import { mealStats, type StatsMeal } from "./meal";
import { timeInRange } from "./range";
import { milliseconds, type TimeRange, type Timestamp } from "./window";
export interface HistoryMeal extends StatsMeal {
  id: string;
  totalCarbs: number;
}
/**
 * The meals of a range, newest first. A meal belongs to its day from the moment it is saved, also
 * when its time is still ahead (the "Spiser om" chips stamp a meal up to twenty minutes ahead);
 * its statistics simply cover nothing yet.
 */
export function mealsInRange(meals: readonly HistoryMeal[], range: TimeRange): HistoryMeal[] {
  return meals
    .filter(
      (meal) =>
        milliseconds(meal.ts) >= milliseconds(range.from) &&
        milliseconds(meal.ts) < milliseconds(range.to),
    )
    .sort((a, b) => milliseconds(b.ts) - milliseconds(a.ts));
}
export function dayStats(
  readings: readonly Reading[],
  meals: readonly HistoryMeal[],
  target: Target,
  dayRange: TimeRange,
  now: Timestamp,
): {
  inRange: InRange;
  meals: { mealId: string; stats: MealStats }[];
  totalCarbs: number;
  mealCount: number;
} {
  const inside = mealsInRange(meals, dayRange);
  return {
    inRange: timeInRange(readings, dayRange, target, now),
    meals: inside.map((meal) => ({
      mealId: meal.id,
      stats: mealStats(readings, meal, target, now),
    })),
    totalCarbs: inside.reduce((sum, meal) => sum + meal.totalCarbs, 0),
    mealCount: inside.length,
  };
}

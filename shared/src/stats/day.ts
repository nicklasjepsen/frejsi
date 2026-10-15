import { type Reading } from "../schemas/glucose";
import { type InRange, type MealStats, type Target } from "../schemas/history";
import { mealStats, type StatsMeal } from "./meal";
import { timeInRange } from "./range";
import { milliseconds, type TimeRange, type Timestamp } from "./window";
export interface HistoryMeal extends StatsMeal {
  id: string;
  totalCarbs: number;
}
export function mealsInRange(
  meals: readonly HistoryMeal[],
  range: TimeRange,
  now: Timestamp,
): HistoryMeal[] {
  return meals
    .filter(
      (meal) =>
        milliseconds(meal.ts) >= milliseconds(range.from) &&
        milliseconds(meal.ts) < milliseconds(range.to) &&
        milliseconds(meal.ts) <= milliseconds(now),
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
  const inside = mealsInRange(meals, dayRange, now);
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

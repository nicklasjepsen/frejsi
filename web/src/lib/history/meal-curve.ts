import {
  EditItem,
  HttpError,
  MealCurveView,
  mealStats,
  mealTitle,
  mealWindow,
  type Locale,
} from "@frejsi/shared";
import { previousOccurrences } from "./previous-occurrences";
import { mealView, requireSpace } from "./views";
import type { HistoryDeps } from "./types";
export async function loadMealCurve(
  spaceId: string,
  id: string,
  locale: Locale,
  deps: HistoryDeps,
): Promise<MealCurveView> {
  const now = deps.now();
  const space = await requireSpace(spaceId, deps);
  const row = await deps.repo.mealById(spaceId, id);
  if (!row) throw new HttpError(404, "not-found");
  const window = mealWindow(row.ts);
  const readings = await deps.repo.readingsBetween(spaceId, window.from, window.to);
  const previous = await Promise.all(
    (await previousOccurrences(row, deps.repo)).map(async (meal) => {
      const range = mealWindow(meal.ts);
      const readings = await deps.repo.readingsBetween(spaceId, range.from, range.to);
      const stats = mealStats(readings, meal, space.target, now);
      return {
        mealId: meal.id,
        ts: meal.ts,
        title: mealTitle(meal.items, meal.note, locale),
        totalCarbs: meal.totalCarbs,
        ...(stats.bolusLeadMinutes === undefined
          ? {}
          : { bolusLeadMinutes: stats.bolusLeadMinutes }),
        stats,
        readings,
      };
    }),
  );
  return MealCurveView.parse({
    meal: await mealView(row, space.timezone, locale, deps, true),
    editItems: row.items.map((item) =>
      EditItem.parse({
        name: item.name,
        carbs: item.carbs,
        grams: item.grams,
        portionLabel: item.portionLabel,
        ...(item.foodId && item.food
          ? {
              foodId: item.foodId,
              portions: item.food.portions,
              carbsPer100g: item.food.carbsPer100g,
            }
          : {}),
      }),
    ),
    window: { from: window.from.toISOString(), to: window.to.toISOString() },
    target: space.target,
    readings,
    stats: mealStats(readings, row, space.target, now),
    previous,
    neighbours: await deps.repo.neighbours(spaceId, row.ts, row.id),
    now: now.toISOString(),
  });
}

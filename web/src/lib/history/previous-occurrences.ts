import { dishKey } from "@frejsi/shared";
import type { HistoryMeal, HistoryRepository } from "./types";
export async function previousOccurrences(
  meal: HistoryMeal,
  repo: HistoryRepository,
): Promise<HistoryMeal[]> {
  const ids = meal.items.map((item) => item.foodId).filter((id): id is string => !!id);
  // The shared dish key also matches snapshots whose food reference was removed or absent.
  const recent = await repo.recentMeals(meal.spaceId, meal.ts, 200);
  const indexed =
    ids.length === meal.items.length
      ? await repo.candidateMeals(meal.spaceId, meal.ts, ids, 200)
      : [];
  const candidates = [
    ...new Map([...indexed, ...recent].map((row) => [row.id, row])).values(),
  ].sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
  const key = dishKey(meal.items);
  // An untouched pump meal is not a dish anyone logged: never an earlier occurrence (v0.7.0).
  return candidates
    .filter((candidate) => candidate.source !== "pump" && dishKey(candidate.items) === key)
    .slice(0, 5);
}

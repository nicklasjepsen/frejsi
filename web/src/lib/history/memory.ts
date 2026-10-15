import type { Neighbours, Reading } from "@frejsi/shared";
import type { HistoryMeal, HistoryRepository, HistorySpace } from "./types";
/** Test fake: records repository reads without mocking the read services. */
export class MemoryHistoryRepository implements HistoryRepository {
  spaces = new Map<string, HistorySpace>();
  meals: HistoryMeal[] = [];
  readings: (Reading & { spaceId: string })[] = [];
  calls: { method: string; args: unknown[] }[] = [];
  private record(method: string, ...args: unknown[]) {
    this.calls.push({ method, args });
  }
  space(id: string) {
    this.record("space", id);
    return Promise.resolve(this.spaces.get(id) ?? null);
  }
  readingsBetween(id: string, from: Date, to: Date): Promise<Reading[]> {
    this.record("readingsBetween", id, from, to);
    return Promise.resolve(
      this.readings
        .filter((r) => r.spaceId === id && Date.parse(r.ts) >= +from && Date.parse(r.ts) <= +to)
        .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
        .map(({ ts, mmol, trend }) => ({ ts, mmol, trend })),
    );
  }
  mealsBetween(id: string, from: Date, to: Date) {
    this.record("mealsBetween", id, from, to);
    return Promise.resolve(
      this.meals
        .filter((m) => m.spaceId === id && Date.parse(m.ts) >= +from && Date.parse(m.ts) < +to)
        .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts)),
    );
  }
  mealById(id: string, mealId: string) {
    this.record("mealById", id, mealId);
    return Promise.resolve(this.meals.find((m) => m.spaceId === id && m.id === mealId) ?? null);
  }
  private earlier(id: string, before: string) {
    return this.meals
      .filter((m) => m.spaceId === id && Date.parse(m.ts) < Date.parse(before))
      .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
  }
  candidateMeals(id: string, before: string, foodIds: string[], limit: number) {
    this.record("candidateMeals", id, before, foodIds, limit);
    return Promise.resolve(
      this.earlier(id, before)
        .filter((m) => m.items.some((i) => i.foodId && foodIds.includes(i.foodId)))
        .slice(0, limit),
    );
  }
  recentMeals(id: string, before: string, limit: number) {
    this.record("recentMeals", id, before, limit);
    return Promise.resolve(this.earlier(id, before).slice(0, limit));
  }
  neighbours(id: string, ts: string, mealId: string): Promise<Neighbours> {
    this.record("neighbours", id, ts, mealId);
    const ordered = this.meals
      .filter((meal) => meal.spaceId === id)
      .sort(
        (a, b) => Date.parse(a.ts) - Date.parse(b.ts) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      );
    const position = ordered.findIndex(
      (meal) => meal.id === mealId && Date.parse(meal.ts) === Date.parse(ts),
    );
    const previous = position >= 0 ? ordered[position - 1] : undefined;
    const next = position >= 0 ? ordered[position + 1] : undefined;
    return Promise.resolve({
      ...(previous ? { previousMealId: previous.id } : {}),
      ...(next ? { nextMealId: next.id } : {}),
    });
  }
  hasAnythingBefore(id: string, ts: Date) {
    this.record("hasAnythingBefore", id, ts);
    return Promise.resolve(
      [...this.meals, ...this.readings].some((r) => r.spaceId === id && Date.parse(r.ts) < +ts),
    );
  }
}

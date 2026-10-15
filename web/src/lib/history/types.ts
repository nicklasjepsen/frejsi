import type { MealItemView, Neighbours, Portion, Reading, Target } from "@frejsi/shared";
import type { PhotoStore } from "@frejsi/shared/photos";
export interface HistoryItem extends MealItemView {
  foodId?: string | undefined;
  food?: { portions: Portion[]; carbsPer100g?: number | undefined } | undefined;
}
export interface HistoryMeal {
  id: string;
  spaceId: string;
  ts: string;
  totalCarbs: number;
  byUser: { id: string; name: string };
  items: HistoryItem[];
  note?: string | undefined;
  bolusTs?: string | undefined;
  photoKey?: string | undefined;
}
export interface HistorySpace {
  timezone: string;
  target: Target;
}
/** All ranges for readings are inclusive; meal ranges have an exclusive end. */
export interface HistoryRepository {
  space(spaceId: string): Promise<HistorySpace | null>;
  readingsBetween(spaceId: string, from: Date, to: Date): Promise<Reading[]>;
  mealsBetween(spaceId: string, from: Date, to: Date): Promise<HistoryMeal[]>;
  mealById(spaceId: string, id: string): Promise<HistoryMeal | null>;
  candidateMeals(
    spaceId: string,
    before: string,
    foodIds: string[],
    limit: number,
  ): Promise<HistoryMeal[]>;
  recentMeals(spaceId: string, before: string, limit: number): Promise<HistoryMeal[]>;
  neighbours(spaceId: string, ts: string): Promise<Neighbours>;
  hasAnythingBefore(spaceId: string, ts: Date): Promise<boolean>;
}
export interface HistoryDeps {
  repo: HistoryRepository;
  photos: PhotoStore | null;
  now: () => Date;
}

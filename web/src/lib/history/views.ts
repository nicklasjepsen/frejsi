import {
  HttpError,
  MealItemView,
  MealView,
  mealSlot,
  mealTitle,
  type Locale,
} from "@frejsi/shared";
import type { HistoryDeps, HistoryMeal } from "./types";
export async function requireSpace(id: string, deps: HistoryDeps) {
  const space = await deps.repo.space(id);
  if (!space) throw new HttpError(404, "not-found");
  return space;
}
export async function mealView(
  row: HistoryMeal,
  timezone: string,
  locale: Locale,
  deps: HistoryDeps,
  detail = false,
): Promise<MealView> {
  const items = row.items.map((item) =>
    MealItemView.parse({
      name: item.name,
      carbs: item.carbs,
      grams: item.grams,
      portionLabel: item.portionLabel,
    }),
  );
  const photo =
    row.photoKey && deps.photos
      ? {
          thumbUrl: await deps.photos.readUrl(row.photoKey, "thumb"),
          originalUrl: await deps.photos.readUrl(row.photoKey, "original"),
        }
      : undefined;
  return MealView.parse({
    id: row.id,
    ts: row.ts,
    totalCarbs: row.totalCarbs,
    byUser: row.byUser,
    items,
    photo,
    symbol: row.symbol ?? "unknown",
    title: mealTitle(items, detail ? row.note : undefined, locale),
    slot: mealSlot(row.ts, timezone),
    ...(detail ? { note: row.note, bolusTs: row.bolusTs } : {}),
  });
}
export const dateAfter = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
export const untilNow = (to: Date, now: Date) => new Date(Math.min(+to, +now));

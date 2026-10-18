import {
  HttpError,
  MealItemView,
  MealView,
  mealSlot,
  mealTitle,
  type Locale,
} from "@frejsi/shared";
import { mealLogger } from "@/lib/meals/logger";

import type { HistoryDeps, HistoryMeal } from "./types";
export async function requireSpace(id: string, deps: HistoryDeps) {
  const space = await deps.repo.space(id);
  if (!space) throw new HttpError(404, "not-found");
  return space;
}
/** The two pump fields the day's meals and the curve carry to owners and carers (plan §4). */
export function pumpLink(row: HistoryMeal) {
  return {
    ...(row.pumpBolusId ? { pumpBolusId: row.pumpBolusId } : {}),
    ...(row.source === "pump" ? { fromPump: true as const } : {}),
  };
}
/** The meal detail's pump record: what the linked bolus delivered and its calculator carbs. */
function pumpDetail(row: HistoryMeal) {
  return {
    ...pumpLink(row),
    ...(row.pumpBolusId && row.pumpBolus
      ? {
          bolusUnits: row.pumpBolus.units,
          ...(row.pumpBolus.carbs ? { pumpCarbs: row.pumpBolus.carbs } : {}),
        }
      : {}),
  };
}
/**
 * A meal as the history routes send it. Every caller is an owner or carer outside simpleMode
 * (`authorizeHistory` refuses the rest), so `detail` carries the pump record too.
 */
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
    byUser: mealLogger(row, locale),
    items,
    photo,
    symbol: row.symbol ?? "unknown",
    title: mealTitle(items, detail ? row.note : undefined, locale),
    slot: mealSlot(row.ts, timezone),
    ...(detail
      ? {
          ...(row.note !== undefined ? { note: row.note } : {}),
          ...(row.bolusTs ? { bolusTs: row.bolusTs } : {}),
          ...pumpDetail(row),
        }
      : {}),
  });
}
export const dateAfter = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
export const untilNow = (to: Date, now: Date) => new Date(Math.min(+to, +now));

// Who a meal view names as its logger (#244). A meal the pump record made from the pump's carbs is
// stored under the owner who connected the pump, because `Meal.byUserId` is required; nobody logged
// it, so until a person ticks "Det passer" or edits it the view names the pump and never that owner.
import type { Locale } from "@frejsi/shared";

import { getMessages } from "@/lib/i18n/messages";

/** `MealView.byUser.id` of an untouched pump meal: not a user id, never looked up. */
export const PUMP_LOGGER_ID = "pump";

export function mealLogger(
  row: { source?: string | null | undefined; byUser: { id: string; name: string } },
  locale: Locale,
): { id: string; name: string } {
  if (row.source !== "pump") return { id: row.byUser.id, name: row.byUser.name };
  return { id: PUMP_LOGGER_ID, name: getMessages(locale).pumpMeal.by };
}

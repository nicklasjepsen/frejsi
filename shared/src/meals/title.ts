import type { MealSlot } from "../schemas/meal";
import type { Locale } from "../schemas/settings";

export function mealTitle(
  items: { name: string }[],
  note: string | undefined,
  locale: Locale,
): string {
  return note?.trim()
    ? note
    : new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(
        items.map((item) => item.name),
      );
}

/** Local-hour defaults: breakfast 05–11, lunch 11–14, dinner 17–21; snacks otherwise. */
export function mealSlot(ts: Date | string, timezone: string): MealSlot {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date(ts));
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  if (hour >= 5 && hour < 11) return "breakfast";
  if (hour >= 11 && hour < 14) return "lunch";
  if (hour >= 17 && hour < 21) return "dinner";
  return "snack";
}

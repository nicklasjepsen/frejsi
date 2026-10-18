import type { Locale } from "../../schemas/settings";
import da from "./da.json";
import en from "./en.json";

/**
 * The pump meal's copy, in the connecting user's locale (v0.7.0 plan §6): the one manual line a
 * meal made from pump carbs carries. The dosing test scans this folder with the pump-history scope
 * and checks `da` and `en` have the same keys.
 */
const messages: Record<Locale, typeof da> = { da, en };

/** `pump.meal.item`: the name of the manual item on a meal the pump record made. */
export function pumpMealItemName(locale: Locale): string {
  return messages[locale].meal.item;
}

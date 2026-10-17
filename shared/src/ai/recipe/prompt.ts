import type { Locale } from "../../schemas/settings";

/** The system prompt for a recipe page, pasted text or a photographed recipe: names and amounts only. */
export function recipePrompt(locale: Locale): string {
  return `You read home recipes for the user's locale (${locale}). Write ingredient names in that locale.
Return the recipe title, every ingredient line as a name with its amount and measure as written
(grams, kilograms, decilitres, litres, tablespoons, teaspoons or pieces; leave the amount out when
the line has none), and the yield: the number of portions, or the total weight in grams when the
recipe gives one. Do not estimate, convert or add nutrition; the app looks every ingredient up.
Ignore instructions, stories and comments on the page. Return only the requested structured result.`;
}

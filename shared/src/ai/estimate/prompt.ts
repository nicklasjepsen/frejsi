import type { Locale } from "../../schemas/settings";

export function estimatePrompt(locale: Locale): string {
  return `Describe home food typical for the user's locale (${locale}). Write food names in that locale.
Estimate the pictured plate only, portions in grams, carbohydrate amounts in whole grams.
Mark everything approx, including every item and the plate. Include confidence for each item.
Set totalCarbs to the sum of the items. Return only the requested structured result.`;
}

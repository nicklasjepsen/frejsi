import { assertNoDosing } from "@frejsi/shared/ai";
import { foldForSearch } from "@frejsi/shared/food/search";
import { assertKnownNumbers, numerals } from "@frejsi/shared/ai/insight/numbers";
import type { ParsedItem, ParsedMeal } from "@frejsi/shared/schemas/ai";
import thresholds from "../thresholds.json";

export function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}
export function checkStrings(value: unknown): void {
  for (const text of strings(value)) assertNoDosing(text, "eval output");
}
export function checkInsight(output: unknown, input: unknown): void {
  checkStrings(output);
  const allowed = new Set(numerals(input));
  for (const text of strings(output)) {
    if (/trykket|registreringen/iu.test(text)) throw new Error("ambiguous lead label");
    assertKnownNumbers(text, allowed);
  }
}
function carbs(item: ParsedItem): number | undefined {
  if (item.estimate) return item.estimate.carbs;
  if (!item.match) return undefined;
  const { food, grams, portionLabel } = item.match;
  if (grams !== undefined && food.carbsPer100g != null) return (grams * food.carbsPer100g) / 100;
  return food.portions.find((portion) => portion.label === portionLabel)?.carbs;
}
export const within = (actual: number | undefined, expected: number, tolerance: number) =>
  actual !== undefined && Math.abs(actual - expected) <= expected * tolerance + 1e-9;
export function scoreParse(
  expected: { name: string; carbs: number }[],
  unmatched: string[],
  actual: ParsedMeal,
) {
  checkStrings(actual);
  const remaining = [...actual.items];
  let found = 0;
  let portions = 0;
  for (const item of expected) {
    const index = remaining.findIndex((candidate) =>
      foldForSearch(candidate.match?.food.name ?? candidate.estimate?.name ?? "").includes(
        foldForSearch(item.name),
      ),
    );
    if (index === -1) continue;
    const [match] = remaining.splice(index, 1);
    found++;
    if (match && within(carbs(match), item.carbs, 0.25)) portions++;
  }
  return {
    expected: expected.length,
    found,
    portions,
    unmatched: unmatched.filter((name) =>
      actual.unmatched.some((value) => foldForSearch(value).includes(foldForSearch(name))),
    ).length,
    expectedUnmatched: unmatched.length,
  };
}
export interface Scores {
  parseRecall: number;
  parsePortions: number;
  photoAccuracy: number;
  photoCount: number;
  normaliseAccuracy: number;
  unmatchedAccuracy: number;
  /** Recipe cases whose line count matched and whose carbs per portion fell within the tolerance. */
  recipeAccuracy: number;
  recipeCount: number;
}
/** A recipe case scores when every line was read and the carbs per portion are close enough. */
export function scoreRecipe(
  expected: { ingredients: number; carbsPerPortion: number },
  actual: { ingredients: number; carbsPerPortion: number | undefined },
): boolean {
  return (
    actual.ingredients === expected.ingredients &&
    within(actual.carbsPerPortion, expected.carbsPerPortion, thresholds.recipeTolerance)
  );
}
export function enforceThresholds(scores: Scores, availablePhotos = scores.photoCount): void {
  for (const key of [
    "parseRecall",
    "parsePortions",
    "normaliseAccuracy",
    "unmatchedAccuracy",
  ] as const)
    if (scores[key] < thresholds[key]) throw new Error(`threshold missed: ${key}`);
  if (availablePhotos >= thresholds.photoMinimum && scores.photoAccuracy < thresholds.photoAccuracy)
    throw new Error("threshold missed: photoAccuracy");
  if (scores.recipeCount > 0 && scores.recipeAccuracy < thresholds.recipeAccuracy)
    throw new Error("threshold missed: recipeAccuracy");
}

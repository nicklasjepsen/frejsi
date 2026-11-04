import { assertNoDosing, findDosingTrip } from "@frejsi/shared/ai";
import { foldForSearch } from "@frejsi/shared/food/search";
import { assertKnownNumbers, numerals, unknownNumbers } from "@frejsi/shared/ai/insight/numbers";
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
/**
 * Why `checkStrings` / `checkInsight` refused an output: the rule and the word or number that
 * tripped it, never the sentence, so a report can name it without printing a model response.
 */
export function describeTrips(output: unknown, input?: unknown): string[] {
  const allowed = input === undefined ? undefined : new Set(numerals(input));
  return strings(output).flatMap((text) => {
    const trips: string[] = [];
    const dosing = findDosingTrip(text, "eval output");
    if (dosing) trips.push(`${dosing.rule} "${dosing.match}"`);
    if (allowed) {
      const label = /trykket|registreringen/iu.exec(text);
      if (label) trips.push(`lead-label "${label[0]}"`);
      for (const n of unknownNumbers(text, allowed)) trips.push(`unknown-number ${String(n)}`);
    }
    return trips;
  });
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
/**
 * A cleaned name scores when it holds the food and the maker, each part of `expected` split at its
 * comma. Spelling a variety out ("Havregryn finvalsede", "Langkornet ris") is a good name, not a miss.
 */
export function scoreNormalise(expected: string, actual: string): boolean {
  const name = foldForSearch(actual);
  return expected.split(",").every((part) => name.includes(foldForSearch(part.trim())));
}
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
  // Every miss at once: a live run costs money, so one run shows them all.
  const missed: string[] = [];
  const check = (key: keyof Scores & keyof typeof thresholds, minimum: number) => {
    if (scores[key] < minimum)
      missed.push(`threshold missed: ${key} ${scores[key].toFixed(2)} < ${String(minimum)}`);
  };
  for (const key of [
    "parseRecall",
    "parsePortions",
    "normaliseAccuracy",
    "unmatchedAccuracy",
  ] as const)
    check(key, thresholds[key]);
  if (availablePhotos >= thresholds.photoMinimum) check("photoAccuracy", thresholds.photoAccuracy);
  if (scores.recipeCount > 0) check("recipeAccuracy", thresholds.recipeAccuracy);
  if (missed.length) throw new Error(missed.join("; "));
}

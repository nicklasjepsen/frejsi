import { foldForSearch } from "../../food/search";
import { carbsFor } from "../../food/portions";
import type { RecipeParse } from "../../schemas/ai";
import type { FoodCandidate, FoodView, LookupResponse, RecipeIngredient } from "../../schemas/food";
import staples from "./data/staples.json";
import { canonicalUnit } from "./jsonld";

export type ParsedLine = RecipeParse["ingredients"][number];
export type RecipeLookup = (query: string) => Promise<LookupResponse>;
export type RecipeMatch = FoodView | FoodCandidate;
/** A line on its way to the review form: the ingredient with the food it matched and the others. */
export type ResolvedLine = RecipeIngredient & { match?: FoodView; candidates?: FoodCandidate[] };

/** Names that resolve to 0 g carbohydrate without a lookup (plan §6), in `da` and `en`. */
export const NO_CARB_STAPLES: ReadonlySet<string> = new Set(staples.names);
const STAPLES: ReadonlySet<string> = new Set(staples.names.map(foldForSearch));
const FILLERS: ReadonlySet<string> = new Set(staples.fillers.map(foldForSearch));
const MAX_QUERY = 80;
const MAX_CANDIDATES = 5;
const MAX_CARBS = 100_000;

function words(name: string): string[] {
  return foldForSearch(name)
    .replace(/[(),.;:!?"']/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** "salt og peber", "lidt salt", "2 spsk olivenolie": the staple itself with fillers and amounts around it. */
export function isNoCarbStaple(name: string): boolean {
  const tokens = words(name).filter(
    (token) => !/^\d+([.,]\d+)?$/.test(token) && !canonicalUnit(token),
  );
  const bare = tokens.filter((token) => !FILLERS.has(token));
  if (bare.length === 0) return false;
  if (STAPLES.has(bare.join(" "))) return true;
  return bare.every((token) => STAPLES.has(token));
}

const isLibrary = (food: RecipeMatch): food is FoodView => "id" in food;

/**
 * Grams for an amount and unit (decision 12): the unit table for g, kg, dl, l, spsk, tsk and the
 * like; a countable unit (stk, dåse, none) through the matched food's first portion.
 */
export function gramsFor(
  amount: number | undefined,
  unit: string | undefined,
  food?: Pick<RecipeMatch, "portions"> | null,
): number | undefined {
  if (amount === undefined) return undefined;
  const known = unit === undefined ? null : canonicalUnit(unit);
  if (unit !== undefined && !known) return undefined;
  if (known?.grams !== undefined) return round(amount * known.grams);
  const grams = food?.portions[0]?.grams;
  return grams === undefined ? undefined : round(amount * grams);
}

const round = (value: number) => Math.round(value * 100) / 100;
const clamp = (value: number, max: number) => Math.min(max, Math.max(0, Math.round(value)));
const unitless = (unit: string | undefined) =>
  unit === undefined || canonicalUnit(unit)?.grams === undefined;

/** One reviewed line: the person's amount, the matched food and the carbs for it. */
export function lineFor(line: ParsedLine, food: RecipeMatch | null): RecipeIngredient {
  const base: RecipeIngredient = {
    name: line.name,
    ...(line.amount === undefined ? {} : { amount: line.amount }),
    ...(line.unit === undefined || line.unit === "" ? {} : { unit: line.unit }),
    carbs: 0,
  };
  if (isNoCarbStaple(line.name)) {
    const grams = gramsFor(line.amount, line.unit);
    return { ...base, ...(grams === undefined ? {} : { grams }), carbs: 0, noCarb: true };
  }
  if (!food) {
    const grams = gramsFor(line.amount, line.unit);
    return { ...base, ...(grams === undefined ? {} : { grams }) };
  }
  const portion = food.portions[0];
  const count =
    unitless(line.unit) && canonicalUnit(line.unit ?? "stk") ? (line.amount ?? 1) : undefined;
  const grams =
    gramsFor(line.amount, line.unit, food) ??
    (count !== undefined && portion?.grams !== undefined
      ? round(count * portion.grams)
      : undefined);
  let carbs = 0;
  if (grams !== undefined && food.carbsPer100g != null) carbs = carbsFor(food, grams);
  else if (count !== undefined && portion) carbs = clamp(count * portion.carbs, MAX_CARBS);
  return {
    ...base,
    ...(grams === undefined ? {} : { grams }),
    ...(isLibrary(food) ? { foodId: food.id } : {}),
    foodName: food.name,
    carbs: clamp(carbs, MAX_CARBS),
  };
}

/**
 * Every line through `lookup()` once, in the order the caller's lookup resolves (library, cache,
 * sources); a `NO_CARB_STAPLES` name costs no lookup. The library match wins, else the first
 * candidate, else no match (plan §6). A failed lookup leaves the line unmatched, never unsaved.
 */
export async function resolveIngredients(
  lines: ParsedLine[],
  lookup: RecipeLookup,
): Promise<ResolvedLine[]> {
  const resolved: ResolvedLine[] = [];
  for (const line of lines) {
    if (isNoCarbStaple(line.name)) {
      resolved.push(lineFor(line, null));
      continue;
    }
    const query = line.name.trim().slice(0, MAX_QUERY).trim();
    let results: LookupResponse["results"] = [];
    if (query) {
      try {
        results = (await lookup(query)).results;
      } catch {
        results = [];
      }
    }
    const library = results.find((result) => result.source === "library" && isLibrary(result.food));
    const chosen = library ?? results[0];
    const candidates = results
      .filter((result) => !isLibrary(result.food))
      .map((result) => result.food as FoodCandidate)
      .slice(0, MAX_CANDIDATES);
    const match = chosen && isLibrary(chosen.food) ? chosen.food : undefined;
    resolved.push({
      ...lineFor(line, chosen?.food ?? null),
      ...(match ? { match } : {}),
      ...(candidates.length ? { candidates } : {}),
    });
  }
  return resolved;
}

// The review form's lines: what the route resolved, plus the match kept so an edited amount can be
// recomputed in the browser exactly as the server computes it (the shared lineFor).
import { gramsFor, lineFor, type RecipeMatch } from "@frejsi/shared/ai/recipe/ingredients";
import type { LookupResult, RecipeIngredient, RecipeReview } from "@frejsi/shared/schemas/food";

export interface ReviewLine extends RecipeIngredient {
  key: number;
  /** The food the carbs come from; absent for a staple or an unmatched line. */
  food?: RecipeMatch;
  /** A model read this line and no human has changed it yet: shown as "ca." (plan §6). */
  approx: boolean;
}

let keys = 0;
export const nextKey = () => ++keys;

function matchOf(line: RecipeReview["lines"][number]): RecipeMatch | undefined {
  if (line.match) return line.match;
  return line.candidates?.find((candidate) => candidate.name === line.foodName);
}

export function linesFrom(review: RecipeReview): ReviewLine[] {
  return review.lines.map((line) => {
    const { match: _match, candidates: _candidates, ...ingredient } = line;
    const food = matchOf(line);
    return { ...ingredient, key: nextKey(), ...(food ? { food } : {}), approx: review.approx };
  });
}

export function linesFromIngredients(ingredients: RecipeIngredient[]): ReviewLine[] {
  return ingredients.map((line) => ({ ...line, key: nextKey(), approx: false }));
}

/**
 * A new amount or unit, recomputed against the line's food. The person touched it: no longer
 * approx. A saved dish opens with its lines' snapshots and not always the food behind them (a
 * candidate from a source has no id); then the carbs scale with the amount from the snapshot,
 * by grams when both are weighed and by count otherwise, never silently to zero.
 */
export function withAmount(
  line: ReviewLine,
  amount: number | undefined,
  unit: string | undefined,
): ReviewLine {
  const parsed = {
    name: line.name,
    ...(amount === undefined ? {} : { amount }),
    ...(unit ? { unit } : {}),
  };
  const base = { key: line.key, approx: false as const };
  if (line.food) return { ...lineFor(parsed, line.food), ...base, food: line.food };
  if (line.noCarb || !line.foodName) return { ...lineFor(parsed, null), ...base };
  const grams = gramsFor(amount, unit);
  const scale =
    grams !== undefined && line.grams !== undefined && line.grams > 0
      ? grams / line.grams
      : amount !== undefined && line.amount !== undefined && line.amount > 0
        ? amount / line.amount
        : undefined;
  const snapshot: ReviewLine = {
    ...line,
    ...parsed,
    ...base,
    foodName: line.foodName,
    ...(line.foodId ? { foodId: line.foodId } : {}),
  };
  delete snapshot.grams;
  if (scale === undefined) return { ...snapshot, carbs: line.carbs };
  const scaledGrams = grams ?? (line.grams === undefined ? undefined : line.grams * scale);
  return {
    ...snapshot,
    ...(scaledGrams === undefined ? {} : { grams: Math.round(scaledGrams * 100) / 100 }),
    carbs: Math.min(100_000, Math.max(0, Math.round(line.carbs * scale))),
  };
}

/** A match picked from a search. */
export function withMatch(line: ReviewLine, result: LookupResult): ReviewLine {
  const food = result.food;
  return {
    ...lineFor(
      {
        name: line.name,
        ...(line.amount === undefined ? {} : { amount: line.amount }),
        ...(line.unit ? { unit: line.unit } : {}),
      },
      food,
    ),
    key: line.key,
    food,
    approx: false,
  };
}

export function newLine(name: string): ReviewLine {
  return { ...lineFor({ name }, null), key: nextKey(), approx: false };
}

/** The lines as the route takes them. */
export function toIngredients(lines: ReviewLine[]): RecipeIngredient[] {
  return lines.map(({ key: _key, food: _food, approx: _approx, ...ingredient }) => ingredient);
}

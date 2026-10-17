// The review form's lines: what the route resolved, plus the match kept so an edited amount can be
// recomputed in the browser exactly as the server computes it (the shared lineFor).
import { lineFor, type RecipeMatch } from "@frejsi/shared/ai/recipe/ingredients";
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

/** A new amount or unit, recomputed against the line's food. The person touched it: no longer approx. */
export function withAmount(
  line: ReviewLine,
  amount: number | undefined,
  unit: string | undefined,
): ReviewLine {
  return {
    ...lineFor(
      { name: line.name, ...(amount === undefined ? {} : { amount }), ...(unit ? { unit } : {}) },
      line.food ?? null,
    ),
    key: line.key,
    ...(line.food ? { food: line.food } : {}),
    approx: false,
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

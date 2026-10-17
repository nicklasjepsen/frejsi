import type { Portion } from "../../schemas/food";

export interface RecipeTotals {
  totalCarbs: number;
  /** The grams the per-100 g value divides by: the yield, else the lines that have grams. */
  baseGrams?: number;
  carbsPer100g?: number;
  portions: Portion[];
}
export interface PortionLabels {
  one: string;
  half: string;
}

const MAX_PER_100 = 100;
const MAX_PORTION_GRAMS = 5000;
const MAX_PORTION_CARBS = 1000;

function portion(label: string, grams: number | undefined, carbs: number): Portion | null {
  const rounded = Math.round(carbs);
  if (rounded > MAX_PORTION_CARBS) return null;
  const weight = grams === undefined ? undefined : Math.round(grams);
  return {
    label,
    ...(weight !== undefined && weight >= 1 && weight <= MAX_PORTION_GRAMS ? { grams: weight } : {}),
    carbs: rounded,
  };
}

/**
 * Carbs per 100 g = total ÷ `yieldGrams` × 100, or ÷ the sum of line grams when only portions are
 * given; the portions "1 portion" and "½ portion" from `yieldPortions` (plan §6). Numbers outside
 * the food contract (per 100 g over 100, a portion over 5 kg or 1 kg of carbohydrate) are left out
 * rather than clamped: the person corrects the line that caused them.
 */
export function computeRecipe(
  lines: { grams?: number | undefined; carbs: number }[],
  yields: { yieldGrams?: number | undefined; yieldPortions?: number | undefined },
  labels: PortionLabels,
): RecipeTotals {
  const totalCarbs = Math.round(lines.reduce((sum, line) => sum + line.carbs, 0));
  const lineGrams = lines.reduce((sum, line) => sum + (line.grams ?? 0), 0);
  const baseGrams = yields.yieldGrams ?? (lineGrams > 0 ? Math.round(lineGrams) : undefined);
  const per100 = baseGrams === undefined ? undefined : Math.round((totalCarbs / baseGrams) * 1000) / 10;
  const portions: Portion[] = [];
  if (yields.yieldPortions !== undefined && yields.yieldPortions > 0) {
    const perPortion = totalCarbs / yields.yieldPortions;
    const grams = baseGrams === undefined ? undefined : baseGrams / yields.yieldPortions;
    for (const [label, share] of [
      [labels.one, 1],
      [labels.half, 0.5],
    ] as const) {
      const made = portion(label, grams === undefined ? undefined : grams * share, perPortion * share);
      if (made) portions.push(made);
    }
  }
  return {
    totalCarbs,
    ...(baseGrams === undefined ? {} : { baseGrams }),
    ...(per100 === undefined || per100 > MAX_PER_100 ? {} : { carbsPer100g: per100 }),
    portions,
  };
}

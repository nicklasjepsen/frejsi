"use client";
import type { FoodCandidate, FoodView } from "@frejsi/shared/schemas/food";
import { useLocale, useTranslations } from "next-intl";

/** The source line of a food row: "Open Food Facts · 40 g pr. 100 g · 1 skive · 18 g". */
export function useSourceLine() {
  const t = useTranslations("log");
  const locale = useLocale();
  const format = (value: number, digits: number) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value);
  const originLabel = (origin: string) =>
    t.has(`origin.${origin}`) ? t(`origin.${origin}`) : t("origin.other");
  const sourceName = (id: string) => (t.has(`origin.${id}`) ? t(`origin.${id}`) : id);
  const per100g = (food: Pick<FoodView, "carbsPer100g">) =>
    food.carbsPer100g == null
      ? null
      : t("results.per100g", { amount: format(food.carbsPer100g, 1) });
  const firstPortion = (food: Pick<FoodView, "portions">) => {
    const portion = food.portions[0];
    return portion
      ? t("results.portion", { label: portion.label, amount: format(portion.carbs, 0) })
      : null;
  };
  const line = (food: FoodView | FoodCandidate) =>
    [originLabel(food.origin), per100g(food), firstPortion(food)]
      .filter((part): part is string => part !== null)
      .join(" · ");
  return { line, originLabel, sourceName, per100g, firstPortion, format };
}

"use client";

import type { MealView } from "@frejsi/shared/schemas/meal";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui";
import { localeHref, type AppLocale } from "@/lib/i18n/routing";

/**
 * "Gem som opskrift" (plan §6): opens the recipe form with the meal's items as lines and the
 * eaten amounts as the yield of one portion. Self-contained: task 8 mounts it in the meal header
 * next to "Gem som egen ret", on phone and desktop. Nothing is saved before the form's "Gem".
 */
export function SaveAsRecipe({ meal, locale }: { meal: Pick<MealView, "id">; locale: AppLocale }) {
  const t = useTranslations("recipe");
  return (
    <Button
      variant="secondary"
      href={`${localeHref(locale, "/recipe/new")}?meal=${encodeURIComponent(meal.id)}`}
    >
      {t("saveAsRecipe")}
    </Button>
  );
}

"use client";
import type { FoodView, Portion } from "@frejsi/shared/schemas/food";
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";

import { OWN_ORIGINS } from "./api-client";

/** How many portions the phone line and the table cell show before they stop. */
const LINE_PORTIONS = 2;

/**
 * The words the library uses for a food, all from `library.*` (plan §4: an origin is labelled by
 * its id with a generic fallback; nothing here names a plugin).
 */
export function useFoodText() {
  const t = useTranslations("library");
  const locale = useLocale();
  return useMemo(() => {
    const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
    const has = (key: string) => t.has(key as never);
    const say = (key: string, values?: Record<string, string | number>) =>
      t(key as never, values as never);

    /** "1 skive 45 g": the weight when the portion has one, else its carbs (Bibliotek-Telefon). */
    const portion = (p: Portion) =>
      say("line.portion", { label: p.label, amount: number.format(p.grams ?? p.carbs) });
    const portions = (food: Pick<FoodView, "portions" | "origin" | "verified">) =>
      food.origin === "ai" && !food.verified && food.portions[0]?.grams != null
        ? say("estimate.portion", { amount: number.format(food.portions[0].grams) })
        : food.portions.slice(0, LINE_PORTIONS).map(portion).join(" · ");

    return {
      asked: (food: FoodView) => {
        const created = new Date(food.createdAt);
        const today = created.toDateString() === new Date().toDateString();
        return say("estimate.askedDesktop", {
          child: food.createdBy?.name ?? say("estimate.someone"),
          date: today
            ? say("estimate.today")
            : new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(created),
          time: new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(
            created,
          ),
        });
      },
      title: (food: FoodView) =>
        food.origin === "ai" ? say("estimate.title", { name: food.name }) : food.name,
      number: (value: number) => number.format(value),
      /** The filter chip: "Fra Open Food Facts", or "Fra {origin}" for a plugin without copy. */
      originFilter: (origin: string) =>
        has(`origin.${origin}`) ? say(`origin.${origin}`) : say("origin.other", { origin }),
      /** The source column and the form's source line: "Open Food Facts", "Egen ret". */
      sourceName: (origin: string) =>
        has(`sourceName.${origin}`) ? say(`sourceName.${origin}`) : origin,
      portions,
      /**
       * A verified food without a per-100 g value can only be picked by portion, which is what
       * the simple picker shows: the row marks it with a badge (`simpleBadge`), not a sentence.
       */
      simpleOnly: (food: Pick<FoodView, "verified" | "carbsPer100g">) =>
        food.verified && food.carbsPer100g == null,
      /**
       * The phone row's secondary line in the artboard's forms: "40 g pr. 100 g · 1 skive 45 g",
       * "Frida · 17 g pr. 100 g", "Egen ret · 1 portion 55 g · ½ portion 28 g".
       */
      line: (food: FoodView) => {
        if (food.origin === "ai" && !food.verified)
          return say("estimate.asked", {
            amount: number.format(food.portions[0]?.carbs ?? food.carbsPer100g ?? 0),
            child: food.createdBy?.name ?? say("estimate.someone"),
            time: new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(
              new Date(food.createdAt),
            ),
          });
        const parts: string[] = [];
        if (has(`line.origin.${food.origin}`)) parts.push(say(`line.origin.${food.origin}`));
        if (food.carbsPer100g != null)
          parts.push(say("line.per100g", { amount: number.format(food.carbsPer100g) }));
        if (food.portions.length > 0) parts.push(portions(food));
        return parts.join(" · ");
      },
      isOwn: (origin: string) => OWN_ORIGINS.has(origin),
    };
  }, [t, locale]);
}

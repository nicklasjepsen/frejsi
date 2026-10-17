"use client";

import type { Role } from "@frejsi/shared/schemas/index";
import type { DayMealView } from "@frejsi/shared/schemas/meal";
import { useTranslations } from "next-intl";

import type { AppLocale } from "@/lib/i18n/routing";

import styles from "./day.module.css";
import { MealCard } from "./MealCard";

/**
 * The day's meals as timeline rows, newest first as the route sends them; or the empty day. With
 * a locale the rows link to their meals, and with the role each row decides on its "Ret".
 */
export function DayList({
  meals,
  timeZone,
  locale,
  role,
}: {
  meals: DayMealView[];
  timeZone: string;
  locale?: AppLocale;
  role?: Role;
}) {
  const t = useTranslations("today");
  if (meals.length === 0) {
    return (
      <p className={styles.empty} data-testid="day-empty">
        {t("empty")}
      </p>
    );
  }
  return (
    <ul className={styles.list} aria-label={t("listLabel")} data-testid="day-list">
      {meals.map((meal) => (
        <li key={meal.id}>
          <MealCard meal={meal} timeZone={timeZone} variant="row" locale={locale} role={role} />
        </li>
      ))}
    </ul>
  );
}

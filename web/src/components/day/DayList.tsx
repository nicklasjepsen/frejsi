"use client";

import type { DayMealView } from "@frejsi/shared/schemas/meal";
import { useTranslations } from "next-intl";

import styles from "./day.module.css";
import { MealCard } from "./MealCard";

/** The day's meals as timeline rows, newest first as the route sends them; or the empty day. */
export function DayList({ meals, timeZone }: { meals: DayMealView[]; timeZone: string }) {
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
          <MealCard meal={meal} timeZone={timeZone} variant="row" />
        </li>
      ))}
    </ul>
  );
}

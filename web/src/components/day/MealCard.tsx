"use client";

import type { DayMealView } from "@frejsi/shared/schemas/meal";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";

import { FoodPhoto } from "@/components/food/FoodPhoto";
import { formatClock } from "@/lib/i18n/time";

import styles from "./day.module.css";

export type MealCardVariant = "card" | "row" | "simple";

const PHOTO_SIZE: Record<MealCardVariant, number> = { card: 64, row: 48, simple: 96 };

/**
 * One meal (design README `MealCard`): `card` is the phone card on Nu ("12:10 · 50 g kulhydrat ·
 * Jonas"), `row` the timeline row of the day with its 48 px time column, `simple` the simpleMode
 * card ("Du spiste kl. 12:10" above the title). The photo is the thumbnail, or the placeholder.
 * The optional row detail is supplied by history; the default remains the meal-only metadata.
 */
export function MealCard({
  meal,
  timeZone,
  variant,
  detail,
}: {
  meal: DayMealView;
  timeZone: string;
  variant: MealCardVariant;
  /** Timeline metadata, including a timestamped peak when the caller has permission. */
  detail?: ReactNode;
}) {
  const t = useTranslations("today");
  const time = formatClock(new Date(meal.ts), timeZone);
  const size = PHOTO_SIZE[variant];
  const photo = (
    <span className={styles.photo} style={{ width: size, height: size }}>
      <FoodPhoto src={meal.photo?.thumbUrl} alt={meal.title} size={size} />
    </span>
  );
  const title = <span className={styles.title}>{meal.title}</span>;
  const facts = { time, carbs: meal.totalCarbs, name: meal.byUser.name };

  if (variant === "simple") {
    return (
      <article className={styles.simple} data-testid="meal-card" data-variant={variant}>
        {photo}
        <div className={styles.text}>
          <span className={styles.meta}>{t("youAte", { time })}</span>
          {title}
        </div>
      </article>
    );
  }

  if (variant === "card") {
    return (
      <article className={styles.card} data-testid="meal-card" data-variant={variant}>
        {photo}
        <div className={styles.text}>
          {title}
          <span className={styles.meta}>{t("mealMeta", facts)}</span>
        </div>
      </article>
    );
  }

  return (
    <article className={styles.row} data-testid="meal-card" data-variant={variant}>
      <time className={styles.time} dateTime={meal.ts}>
        {time}
      </time>
      {photo}
      <div className={styles.text}>
        {title}
        <span className={styles.meta}>{detail ?? t("mealCarbs", facts)}</span>
      </div>
    </article>
  );
}

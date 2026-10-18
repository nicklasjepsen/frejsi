"use client";

import type { MealItemView } from "@frejsi/shared/schemas/meal";
import { useTranslations } from "next-intl";

import styles from "./meal-detail.module.css";

/** "Rugbrød · 2 skiver", "Æble · 120 g", or the name alone. */
export function useItemLine(): (item: MealItemView) => string {
  const t = useTranslations("mealDetail");
  return (item) =>
    item.portionLabel
      ? t("itemLine", { name: item.name, portion: item.portionLabel })
      : item.grams !== undefined
        ? t("itemLine", { name: item.name, portion: t("grams", { grams: item.grams }) })
        : item.name;
}

/**
 * The meal's items (Maaltid-Telefon, Maaltid-Desktop): "{name} · {portion}" at 15 px on the left,
 * the carbs right-aligned at 700 tabular, a zero in the muted colour; on desktop "I alt" last.
 */
export function MealItems({
  items,
  total,
  pumpCarbs,
  size,
}: {
  items: readonly MealItemView[];
  /** Desktop only: the "I alt" row. */
  total?: number;
  /** Desktop only: "Pumpen: 45 g" under "I alt", the carbs typed into the pump (v0.7.0 plan §9). */
  pumpCarbs?: number | undefined;
  size: "phone" | "desktop";
}) {
  const t = useTranslations("mealDetail");
  const pump = useTranslations("pumpMeal");
  const line = useItemLine();
  return (
    <ul className={styles.items} data-size={size} data-testid="meal-items">
      {items.map((item, index) => (
        <li key={index} className={styles.item}>
          <span>{line(item)}</span>
          <span className={styles.carbs} data-zero={item.carbs === 0} data-part="carbs">
            {t("grams", { grams: item.carbs })}
          </span>
        </li>
      ))}
      {total !== undefined && (
        <li className={styles.item} data-total="true">
          <span>{t("total")}</span>
          <span className={styles.carbs} data-part="carbs">
            {t("grams", { grams: total })}
          </span>
        </li>
      )}
      {total !== undefined && pumpCarbs !== undefined && (
        <li className={styles.item} data-part="pump-carbs">
          <span>{pump("pumpCarbs", { grams: pumpCarbs })}</span>
        </li>
      )}
    </ul>
  );
}

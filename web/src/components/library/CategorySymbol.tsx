"use client";
import type { FoodCategory } from "@frejsi/shared/schemas/food";
import { useTranslations } from "next-intl";

import { FoodSymbol } from "@/components/food/FoodSymbol";

import styles from "./library.module.css";

/**
 * A category's symbol with its name, for the library rows and the food form's chips: the one
 * drawing of `FoodSymbol` (the curve lane's, v0.6.0 task 5) under a span that carries the name.
 */
export function CategorySymbol({
  category,
  size = 20,
  decorative = false,
}: {
  category: FoodCategory;
  /** Width and height in px. */
  size?: number;
  /** Inside a chip that already says the name: hidden from the accessibility tree. */
  decorative?: boolean;
}) {
  const t = useTranslations("foodCategory");
  const name = t(`names.${category}`);
  return (
    <span
      className={styles.categorySymbol}
      style={{ width: size, height: size }}
      data-testid="category-symbol"
      data-category={category}
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": name, title: name })}
    >
      <FoodSymbol symbol={category} size={size} />
    </span>
  );
}

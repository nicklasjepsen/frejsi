"use client";
import type { FoodCategory } from "@frejsi/shared/schemas/food";
import { useTranslations } from "next-intl";

import styles from "./library.module.css";

/**
 * The ten food symbols as described in the v0.6.0 plan §7: inline SVG, stroke `currentColor`,
 * round caps, on a 24-unit viewBox, legible at 12 px. Task 5 (#202) draws the curve's
 * `FoodSymbol` in `components/food/`; until it lands the library carries this copy, and swapping
 * the import is the only change the rows need afterwards.
 */
const PATHS: Record<FoodCategory, string> = {
  // a loaf
  bread:
    "M4 13.5a3.5 3.5 0 0 1 3.5-3.5h9a3.5 3.5 0 0 1 0 7h-9A3.5 3.5 0 0 1 4 13.5Zm4 0v3.5m4-3.5v3.5m4-3.5v3.5",
  // an apple
  fruit:
    "M12 7c1.8-1.6 4.5-1.4 6 .8 1.8 2.8.5 7.8-2.5 10-1 .8-2.3.3-3.5.3s-2.5.5-3.5-.3C5.5 15.6 4.2 10.6 6 7.8 7.5 5.6 10.2 5.4 12 7Zm0 0c0-1.5.7-2.5 2-3",
  // a carrot
  vegetables:
    "M15 9 5.5 18.5 4 20l1.5-1.5L15 9Zm0 0c2-2 4-2.5 5-2-0.5 1-1 3-3 5m-3.3-2.3L12 6m2.3 4.3L18 10",
  // a glass
  dairy: "M7 4h10l-1 16H8L7 4Zm.6 6h8.8",
  // a bowl with a fork
  starch: "M4 12h16a8 8 0 0 1-16 0Zm4-8v6m-1.5-6v3a1.5 1.5 0 0 0 3 0V4",
  // a drumstick
  protein:
    "M14.5 4.5a4.5 4.5 0 0 1 3 7.5l-6.5 6.5-2-2 6.5-6.5a4.5 4.5 0 0 1-1-5.5Zm-6.5 9-2.5 2.5-1 3 3-1 2.5-2.5",
  // a lollipop
  sweets: "M14.5 9.5a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Zm-3.2 3.2L17 20M8 9.5a2 2 0 0 1 2-2",
  // a pretzel
  snack:
    "M8 18c-3 0-4-2.5-4-4.5C4 10 7 8 9.5 9.5L16 16c3-2 4-4.5 3-6.5-1-2-3-2.5-5-1.5L8 14.5c-1.5 2-.5 3.5 0 3.5Zm8 0c.5 0 1.5-1.5 0-3.5",
  // a cup with a straw
  drink: "M6 9h12l-1 11H7L6 9Zm2.5 0 4-6",
  // a plate
  mixed: "M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm0-4a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
};

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
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d={PATHS[category]} />
      </svg>
    </span>
  );
}

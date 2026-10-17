"use client";
import { FoodCategory } from "@frejsi/shared/schemas/food";
import { useTranslations } from "next-intl";
import type { KeyboardEvent } from "react";

import { Chip } from "@/components/ui";

import { CategorySymbol } from "./CategorySymbol";
import styles from "./library.module.css";

/**
 * The "Kategori" row of the food form (v0.6.0 plan §7): "Ingen kategori" and the ten categories,
 * each chip a symbol and a name. The same radiogroup contract as the kit's `ChipGroup` (one
 * pressed, roving tab stop, arrow keys), on the kit's `Chip`, because `ChipGroup` labels are plain
 * strings and these chips carry a drawing.
 */
export function CategoryChips({
  value,
  onChange,
}: {
  value: FoodCategory | "";
  onChange: (value: FoodCategory | "") => void;
}) {
  const t = useTranslations("foodCategory");
  const options: (FoodCategory | "")[] = ["", ...FoodCategory.options];
  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    const chips = event.currentTarget.parentElement?.querySelectorAll<HTMLElement>("[role=radio]");
    chips?.[next]?.focus();
    onChange(options[next] ?? "");
  };
  return (
    <div role="radiogroup" aria-label={t("label")} className={styles.categoryChips}>
      {options.map((option, index) => {
        const checked = option === value;
        return (
          <Chip
            key={option || "none"}
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            pressed={checked}
            className={styles.categoryChip}
            onKeyDown={(event) => {
              move(event, index);
            }}
            onClick={() => {
              onChange(option);
            }}
          >
            {option && <CategorySymbol category={option} size={18} decorative />}
            <span>{option ? t(`names.${option}`) : t("none")}</span>
          </Chip>
        );
      })}
    </div>
  );
}

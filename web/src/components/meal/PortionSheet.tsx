"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { PortionChips, type PortionChoice } from "../food/PortionChips";
import { NumberInput } from "../ui/NumberInput";
import type { DraftItem } from "./draft";
import styles from "./meal.module.css";

/**
 * "Hvor meget {name}?" with the food's first-class portions and "Vej det" where a per-100 g value
 * exists (decision 2). On the phone "Vej det" opens a grams field; on desktop the grams input sits
 * inline with the chips (Log-Desktop).
 */
export function PortionSheet({
  item,
  onPortion,
  onGrams,
  desktop = false,
}: {
  item: DraftItem;
  onPortion: (index: number) => void;
  onGrams: (grams: number) => void;
  desktop?: boolean;
}) {
  const t = useTranslations("log");
  const kit = useTranslations("foodKit");
  const food = item.food;
  const choice = item.choice;
  const [weighing, setWeighing] = useState(choice !== null && "grams" in choice);
  if (!food) return null;
  const choices: PortionChoice[] = food.portions.map(({ label, carbs, grams: weight }) =>
    weight === undefined ? { label, carbs } : { label, carbs, grams: weight },
  );
  const selectedIndex = choice && "portion" in choice ? choice.portion : undefined;
  const grams = choice && "grams" in choice ? choice.grams : undefined;
  const setGrams = (value: number | undefined) => {
    if (value !== undefined && value >= 1 && value <= 5000) onGrams(value);
  };
  return (
    <section className={styles.portionSheet} aria-label={t("portionQuestion", { name: food.name })}>
      {!desktop && (
        <h2 className={styles.portionQuestion}>{t("portionQuestion", { name: food.name })}</h2>
      )}
      <PortionChips
        portions={choices}
        carbsPer100g={food.carbsPer100g ?? null}
        {...(selectedIndex !== undefined ? { selectedIndex } : {})}
        onSelect={(portion) => {
          setWeighing(false);
          onPortion(choices.indexOf(portion));
        }}
        onWeigh={() => {
          setWeighing(true);
        }}
        {...(grams !== undefined ? { grams } : {})}
        onGramsChange={setGrams}
        desktop={desktop}
      />
      {!desktop && weighing && food.carbsPer100g != null && (
        <div className={styles.weigh}>
          <NumberInput
            label={kit("grams")}
            min={1}
            max={5000}
            step={1}
            autoFocus
            defaultValue={grams ?? ""}
            onChange={(event) => {
              setGrams(
                Number.isFinite(event.target.valueAsNumber)
                  ? event.target.valueAsNumber
                  : undefined,
              );
            }}
          />
        </div>
      )}
    </section>
  );
}

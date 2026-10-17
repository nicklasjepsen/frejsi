"use client";
// "Spiser om": when eating starts, as one tap (issue #191). A radiogroup of buttons, like the
// settings' SegmentedControl; the value is minutes, resolved against the save moment by the
// draft (`eatingInTs`), so the chips never carry a clock time. No selection means a time was set
// by hand (or a saved meal is being edited).
import { useTranslations } from "next-intl";
import { useId } from "react";

import { EATING_IN_CHOICES, type EatingIn } from "./draft";
import styles from "./meal.module.css";

export function EatingInChips({
  value,
  onChange,
  simple = false,
}: {
  value: EatingIn | null;
  onChange: (eatingIn: EatingIn) => void;
  /** simpleMode: the 48 px touch height. */
  simple?: boolean;
}) {
  const t = useTranslations("log.eatingIn");
  const labelId = useId();
  return (
    <div className={styles.eatingIn} data-simple={simple} data-testid="eating-in">
      <span id={labelId} className={styles.eatingInLabel}>
        {t("label")}
      </span>
      <div role="radiogroup" aria-labelledby={labelId} className={styles.eatingInChips}>
        {EATING_IN_CHOICES.map((minutes) => (
          <button
            key={minutes}
            type="button"
            role="radio"
            aria-checked={value === minutes}
            className={styles.eatingInChip}
            onClick={() => {
              if (value !== minutes) onChange(minutes);
            }}
          >
            {minutes === 0 ? t("now") : t("minutes", { minutes })}
          </button>
        ))}
      </div>
    </div>
  );
}

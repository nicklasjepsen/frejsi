"use client";

import { carbsFor } from "@frejsi/shared/food/portions";
import type { EditItem } from "@frejsi/shared/schemas/history";
import type { MealItemInput } from "@frejsi/shared/schemas/meal";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { PortionChips } from "@/components/food/PortionChips";
import { NumberInput } from "@/components/ui/NumberInput";

import styles from "./meal.module.css";

export interface EditableItem {
  key: number;
  source: EditItem;
  input: MealItemInput;
  valid: boolean;
}

export const editableItems = (items: EditItem[]): EditableItem[] =>
  items.map((source, key) => ({
    key,
    source,
    valid: true,
    input: {
      name: source.name,
      ...(source.foodId ? { foodId: source.foodId } : {}),
      ...(source.portionLabel &&
      (!source.foodId || source.portions?.some((p) => p.label === source.portionLabel))
        ? { portionLabel: source.portionLabel }
        : {}),
      ...(source.grams !== undefined ? { grams: source.grams } : {}),
      carbs: source.carbs,
    },
  }));

/** The API recomputes a replacement array from current foods. Show exactly those carbs before Save. */
export function refreshNutrition(item: EditableItem): EditableItem {
  if (!item.valid || !item.input.foodId) return item;
  const portion = item.source.portions?.find((p) => p.label === item.input.portionLabel);
  const carbs = portion
    ? carbsFor(item.source, portion)
    : item.input.grams !== undefined && item.source.carbsPer100g != null
      ? carbsFor(item.source, item.input.grams)
      : item.input.carbs;
  return {
    ...item,
    input: { ...item.input, carbs },
    valid: carbs !== undefined && carbs >= 0 && carbs <= 1000,
  };
}

/** The confirm screen's portions in edit mode, using the route's exact food ids, never name lookup. */
export function EditMealItems({
  items,
  desktop,
  onChange,
  onRemove,
}: {
  items: EditableItem[];
  desktop: boolean;
  onChange: (key: number, input: MealItemInput, valid: boolean) => void;
  onRemove: (key: number) => void;
}) {
  const t = useTranslations("log");
  return (
    <ul className={`${styles.items} ${styles.editItems}`}>
      {items.map((item) => (
        <li key={item.key} className={styles.item}>
          <div className={styles.itemRow}>
            <span className={styles.itemName}>{item.source.name}</span>
            <span className={styles.itemCarbs}>
              {t("totalAmount", { amount: item.input.carbs ?? 0 })}
            </span>
            <button
              type="button"
              className={styles.removeButton}
              aria-label={t("remove", { name: item.source.name })}
              onClick={() => {
                onRemove(item.key);
              }}
            >
              ×
            </button>
          </div>
          <EditQuantity
            item={item}
            desktop={desktop}
            onChange={(input, valid) => {
              onChange(item.key, input, valid);
            }}
          />
        </li>
      ))}
    </ul>
  );
}

function EditQuantity({
  item,
  desktop,
  onChange,
}: {
  item: EditableItem;
  desktop: boolean;
  onChange: (input: MealItemInput, valid: boolean) => void;
}) {
  const kit = useTranslations("foodKit");
  const t = useTranslations("mealDetail");
  const [weighing, setWeighing] = useState(
    item.input.grams !== undefined && !item.input.portionLabel,
  );
  const { source, input } = item;
  const portions = (source.portions ?? []).map((p) => ({
    label: p.label,
    carbs: p.carbs,
    ...(p.grams === undefined ? {} : { grams: p.grams }),
  }));
  const canWeigh = source.carbsPer100g != null;
  const base = { name: source.name, ...(source.foodId ? { foodId: source.foodId } : {}) };
  const grams = (
    <NumberInput
      label={kit("grams")}
      name={`grams-${item.key}`}
      min={1}
      max={5000}
      step={1}
      value={input.grams ?? ""}
      onChange={(event) => {
        const value = event.target.valueAsNumber;
        const valid = Number.isInteger(value) && value >= 1 && value <= 5000;
        onChange(
          {
            ...base,
            ...(valid ? { grams: value } : {}),
            carbs: valid ? carbsFor(source, value) : 0,
          },
          valid,
        );
      }}
    />
  );
  return (
    <div className={styles.portionSheet}>
      {source.foodId && (
        <PortionChips
          portions={portions}
          {...(source.carbsPer100g == null ? {} : { carbsPer100g: source.carbsPer100g })}
          selectedIndex={portions.findIndex((p) => p.label === input.portionLabel)}
          onSelect={(portion) => {
            setWeighing(false);
            onChange(
              { ...base, portionLabel: portion.label, carbs: carbsFor(source, portion) },
              true,
            );
          }}
          onWeigh={() => {
            setWeighing(true);
          }}
        />
      )}
      {source.foodId && canWeigh && (desktop || weighing) && grams}
      {(!source.foodId || (!canWeigh && portions.length === 0)) && (
        <NumberInput
          label={t("editSheet.carbs", { name: source.name })}
          name={`carbs-${item.key}`}
          min={0}
          max={1000}
          step={1}
          value={item.valid ? (input.carbs ?? "") : ""}
          onChange={(event) => {
            const value = event.target.valueAsNumber;
            const valid = Number.isInteger(value) && value >= 0 && value <= 1000;
            onChange({ ...input, carbs: valid ? value : 0 }, valid);
          }}
        />
      )}
    </div>
  );
}

"use client";
import type { CreateFoodRequest } from "@frejsi/shared/schemas/food";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

import { Button } from "../ui/Button";
import { NumberInput } from "../ui/NumberInput";
import { TextInput } from "../ui/TextInput";
import styles from "./meal.module.css";

const parse = (value: string): number | undefined => {
  const n = Number(value.replace(",", "."));
  return value.trim() === "" || !Number.isFinite(n) ? undefined : n;
};

/**
 * "Jeg kender tallet selv" (§4 step 5): a food with the family's own numbers, created inline as a
 * `manual` food, `verified: false` (the route sets both). A scanned barcode that nothing knew is
 * prefilled, so the supermarket case never dead-ends (decision 31).
 */
export function ManualFoodForm({
  initialName,
  barcode,
  busy,
  failed,
  onCreate,
  onCancel,
}: {
  /** Desktop: back to the results without creating anything (the phone has its header back). */
  onCancel?: () => void;
  initialName: string;
  barcode?: string | undefined;
  busy: boolean;
  failed: boolean;
  onCreate: (request: CreateFoodRequest) => void;
}) {
  const t = useTranslations("log.manual");
  const cancel = useTranslations("log");
  const [name, setName] = useState(initialName);
  const [per100g, setPer100g] = useState("");
  const [portionLabel, setPortionLabel] = useState("");
  const [portionCarbs, setPortionCarbs] = useState("");
  const carbsPer100g = parse(per100g);
  const carbs = parse(portionCarbs);
  const portion =
    portionLabel.trim() !== "" && carbs !== undefined
      ? { label: portionLabel.trim(), carbs }
      : null;
  const valid =
    name.trim() !== "" &&
    (carbsPer100g === undefined || (carbsPer100g >= 0 && carbsPer100g <= 100)) &&
    (carbs === undefined || (Number.isInteger(carbs) && carbs >= 0 && carbs <= 1000)) &&
    (carbsPer100g !== undefined || portion !== null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid || busy) return;
    onCreate({
      name: name.trim(),
      ...(carbsPer100g !== undefined ? { carbsPer100g: Math.round(carbsPer100g * 10) / 10 } : {}),
      portions: portion ? [portion] : [],
      ...(barcode ? { barcode } : {}),
    });
  };
  return (
    <form className={styles.manualForm} onSubmit={submit} aria-label={t("title")}>
      <h2 className={styles.sectionTitle}>{t("title")}</h2>
      {barcode && <p className={styles.muted}>{t("barcode", { code: barcode })}</p>}
      <TextInput
        label={t("name")}
        value={name}
        maxLength={200}
        onChange={(event) => {
          setName(event.target.value);
        }}
      />
      <NumberInput
        label={t("per100g")}
        value={per100g}
        min={0}
        max={100}
        step={0.1}
        onChange={(event) => {
          setPer100g(event.target.value);
        }}
      />
      <div className={styles.manualPortion}>
        <TextInput
          label={t("portionLabel")}
          value={portionLabel}
          maxLength={40}
          onChange={(event) => {
            setPortionLabel(event.target.value);
          }}
        />
        <NumberInput
          label={t("portionCarbs")}
          value={portionCarbs}
          min={0}
          max={1000}
          step={1}
          onChange={(event) => {
            setPortionCarbs(event.target.value);
          }}
        />
      </div>
      <p className={styles.muted}>{t("hint")}</p>
      {failed && <p role="alert">{t("failed")}</p>}
      <Button type="submit" size="phone" disabled={!valid || busy}>
        {t("create")}
      </Button>
      {onCancel && (
        <Button variant="secondary" onClick={onCancel}>
          {cancel("cancel")}
        </Button>
      )}
    </form>
  );
}

"use client";
import { computeRecipe } from "@frejsi/shared/ai/recipe/compute";
import type { FoodView, RecipeReview as Review, RecipeSource } from "@frejsi/shared/schemas/food";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useId, useState, type FormEvent } from "react";

import { FoodPhoto } from "@/components/food/FoodPhoto";
import { Button, NumberInput, TextInput } from "@/components/ui";
import { localeHref, type AppLocale } from "@/lib/i18n/routing";

import { recipeApi } from "./api";
import { IngredientRow } from "./IngredientRow";
import { linesFrom, newLine, toIngredients, type ReviewLine } from "./lines";
import styles from "./recipes.module.css";

function parseNumber(value: string): number | undefined {
  const trimmed = value.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return undefined;
  return Number(trimmed);
}

export interface ReviewProps {
  spaceId: string;
  locale: AppLocale;
  review: Review;
  /** The photo the recipe came from; becomes the dish photo on save. */
  photoDataUrl?: string | undefined;
  /** A dish being edited: "Gem" recalculates it instead of creating one. */
  foodId?: string | undefined;
  portionLabels?: { one: string; half: string } | undefined;
}

/**
 * The review form (plan §6): every line with its match, amount and carbs ("ca." on model-read lines
 * until edited), the total and carbs per 100 g updating live, the yield and the portion names.
 * Nothing is posted until "Gem".
 */
export function RecipeReview({
  spaceId,
  locale,
  review,
  photoDataUrl,
  foodId,
  portionLabels,
}: ReviewProps) {
  const t = useTranslations("recipe.review");
  const portion = useTranslations("recipe.portion");
  const [title, setTitle] = useState(review.title);
  const [lines, setLines] = useState<ReviewLine[]>(() => linesFrom(review));
  const [portions, setPortions] = useState(
    review.yieldPortions === undefined ? "" : String(review.yieldPortions),
  );
  const [grams, setGrams] = useState(
    review.yieldGrams === undefined ? "" : String(review.yieldGrams),
  );
  const [labels, setLabels] = useState(
    portionLabels ?? { one: portion("one"), half: portion("half") },
  );
  const [addName, setAddName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<FoodView | null>(null);
  const [problem, setProblem] = useState<
    "needsName" | "needsLines" | "needsYield" | "failed" | null
  >(null);
  const headingId = useId();
  const yieldPortions = parseNumber(portions);
  const yieldGrams = parseNumber(grams);
  const totals = computeRecipe(
    lines,
    {
      ...(yieldPortions !== undefined && yieldPortions >= 0.5 ? { yieldPortions } : {}),
      ...(yieldGrams !== undefined && yieldGrams >= 1 ? { yieldGrams } : {}),
    },
    labels,
  );
  const sourceText = (source: RecipeSource) =>
    source.kind === "url"
      ? t("source.url", { host: hostOf(source.url) })
      : t(`source.${source.kind}`);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving || saved) return;
    const hasPortions =
      yieldPortions !== undefined && yieldPortions >= 0.5 && yieldPortions <= 1000;
    const hasGrams = yieldGrams !== undefined && yieldGrams >= 1 && yieldGrams <= 100_000;
    const missing = !title.trim()
      ? "needsName"
      : lines.length === 0
        ? "needsLines"
        : !hasPortions && !hasGrams
          ? "needsYield"
          : null;
    if (missing) {
      setProblem(missing);
      return;
    }
    setSaving(true);
    setProblem(null);
    const yields = {
      ...(hasPortions ? { yieldPortions } : {}),
      ...(hasGrams ? { yieldGrams } : {}),
    };
    try {
      const food = foodId
        ? await recipeApi.recalc(spaceId, foodId, {
            title: title.trim(),
            ingredients: toIngredients(lines),
            yieldPortions: hasPortions ? yieldPortions : null,
            yieldGrams: hasGrams ? yieldGrams : null,
            portionLabels: labels,
          })
        : await recipeApi.save(spaceId, {
            title: title.trim(),
            ingredients: toIngredients(lines),
            ...yields,
            source: review.source,
            portionLabels: labels,
            ...(photoDataUrl ? { photoDataUrl } : {}),
          });
      setSaved(food);
    } catch {
      setProblem("failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className={styles.form}
      aria-labelledby={headingId}
      noValidate
      onSubmit={(event) => void submit(event)}
    >
      <h2 id={headingId} className="visually-hidden">
        {review.title}
      </h2>
      {photoDataUrl && <FoodPhoto src={photoDataUrl} alt="" size={72} />}
      <p className={styles.muted}>{sourceText(review.source)}</p>
      <TextInput
        label={t("name")}
        value={title}
        maxLength={200}
        autoComplete="off"
        onChange={(event) => {
          setTitle(event.target.value);
        }}
      />
      {review.approx && <p className={styles.muted}>{t("approxNote")}</p>}
      <h3 className={styles.muted}>{t("lines")}</h3>
      <ul className={styles.lines} role="list">
        {lines.map((line) => (
          <IngredientRow
            key={line.key}
            spaceId={spaceId}
            line={line}
            onChange={(next) => {
              setLines((list) => list.map((item) => (item.key === next.key ? next : item)));
            }}
            onRemove={() => {
              setLines((list) => list.filter((item) => item.key !== line.key));
            }}
          />
        ))}
      </ul>
      <div className={styles.searchRow}>
        <TextInput
          label={t("line")}
          value={addName}
          maxLength={120}
          autoComplete="off"
          placeholder={t("newLine")}
          onChange={(event) => {
            setAddName(event.target.value);
          }}
        />
        <Button
          variant="secondary"
          size="phone"
          disabled={!addName.trim() || lines.length >= 40}
          onClick={() => {
            setLines((list) => [...list, newLine(addName.trim())]);
            setAddName("");
          }}
        >
          {t("addLine")}
        </Button>
      </div>
      <div className={styles.totals}>
        <div className={styles.totalRow}>
          <span>{t("total")}</span>
          <output>{t("totalCarbs", { amount: totals.totalCarbs })}</output>
        </div>
        <p className={styles.muted}>
          {totals.carbsPer100g === undefined
            ? t("per100gUnknown")
            : t("per100g", { amount: totals.carbsPer100g })}
        </p>
      </div>
      <fieldset className={styles.yield}>
        <legend>{t("yield")}</legend>
        <div className={styles.amounts}>
          <NumberInput
            label={t("yieldPortions")}
            min={0.5}
            max={1000}
            step="any"
            value={portions}
            onChange={(event) => {
              setPortions(event.target.value);
            }}
          />
          <NumberInput
            label={t("yieldGrams")}
            min={1}
            max={100000}
            step={1}
            value={grams}
            onChange={(event) => {
              setGrams(event.target.value);
            }}
          />
        </div>
      </fieldset>
      <fieldset className={styles.yield}>
        <legend>{t("portionNames")}</legend>
        <div className={styles.amounts}>
          <TextInput
            label={t("portionOne")}
            value={labels.one}
            maxLength={40}
            onChange={(event) => {
              setLabels((current) => ({ ...current, one: event.target.value }));
            }}
          />
          <TextInput
            label={t("portionHalf")}
            value={labels.half}
            maxLength={40}
            onChange={(event) => {
              setLabels((current) => ({ ...current, half: event.target.value }));
            }}
          />
        </div>
        <ul className={styles.results} role="list">
          {totals.portions.map((item) => (
            <li key={item.label} className={styles.muted}>
              {t("portionLine", { label: item.label, carbs: item.carbs })}
            </li>
          ))}
        </ul>
      </fieldset>
      <div className={styles.actions}>
        <Button type="submit" disabled={saving || saved !== null}>
          {saving ? t("saving") : t("save")}
        </Button>
        {problem && (
          <p className={styles.problem} role="alert">
            {t(problem)}
          </p>
        )}
        {saved && (
          <p role="status">
            {t("saved")}{" "}
            <Link href={localeHref(locale, `/library/${encodeURIComponent(saved.id)}`)}>
              {t("openInLibrary")}
            </Link>
          </p>
        )}
      </div>
    </form>
  );
}

function hostOf(url: string | undefined): string {
  try {
    return url ? new URL(url).host : "";
  } catch {
    return "";
  }
}

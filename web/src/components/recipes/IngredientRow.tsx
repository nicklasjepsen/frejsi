"use client";
import type { LookupResponse, LookupResult } from "@frejsi/shared/schemas/food";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";

import { lookupText } from "@/components/meal/api";
import { Button, NumberInput, TextInput } from "@/components/ui";

import { withAmount, withMatch, type ReviewLine } from "./lines";
import styles from "./recipes.module.css";

/** "40,5" and "40.5" both read as 40.5. */
function parseAmount(value: string): number | undefined {
  const trimmed = value.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return undefined;
  const parsed = Number(trimmed);
  return parsed >= 0 && parsed <= 100_000 ? parsed : undefined;
}

/**
 * One line of the review (plan §6): the name, the amount and unit, the matched food and the carbs,
 * "ca." while a model's reading stands untouched. The match changes by search, the amount by
 * typing, and the line can go.
 */
export function IngredientRow({
  spaceId,
  line,
  onChange,
  onRemove,
}: {
  spaceId: string;
  line: ReviewLine;
  onChange: (line: ReviewLine) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("recipe.review");
  const [amount, setAmount] = useState(line.amount === undefined ? "" : String(line.amount));
  const [unit, setUnit] = useState(line.unit ?? "");
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState(line.name);
  const [results, setResults] = useState<LookupResponse["results"] | null>(null);
  const [busy, setBusy] = useState(false);
  const nameId = useId();
  const apply = (nextAmount: string, nextUnit: string) => {
    onChange(withAmount(line, parseAmount(nextAmount), nextUnit.trim().slice(0, 20) || undefined));
  };
  async function search() {
    if (!query.trim() || busy) return;
    setBusy(true);
    try {
      setResults((await lookupText(spaceId, query, true)).results);
    } catch {
      setResults([]);
    } finally {
      setBusy(false);
    }
  }
  const pick = (result: LookupResult) => {
    onChange(withMatch(line, result));
    setSearching(false);
    setResults(null);
  };
  const matchText = line.noCarb
    ? t("noCarb")
    : line.foodName
      ? t("match", { name: line.foodName })
      : t("noMatch");
  return (
    <li className={styles.line} data-testid="ingredient-row">
      <div className={styles.lineHead}>
        <span className={styles.lineName} id={nameId}>
          {line.name}
        </span>
        {line.approx && (
          <span className={styles.approx} title={t("approxNote")}>
            {t("approx")}
          </span>
        )}
        <span className={styles.lineCarbs}>{t("lineCarbs", { amount: line.carbs })}</span>
        <button
          type="button"
          className={styles.remove}
          aria-label={t("remove", { name: line.name })}
          onClick={onRemove}
        >
          ×
        </button>
      </div>
      <div className={styles.amounts}>
        <NumberInput
          label={t("amount")}
          name={`amount-${line.key}`}
          min={0}
          max={100000}
          step="any"
          value={amount}
          onChange={(event) => {
            setAmount(event.target.value);
            apply(event.target.value, unit);
          }}
        />
        <TextInput
          label={t("unit")}
          name={`unit-${line.key}`}
          maxLength={20}
          autoComplete="off"
          value={unit}
          onChange={(event) => {
            setUnit(event.target.value);
            apply(amount, event.target.value);
          }}
        />
      </div>
      <div className={styles.matchRow}>
        <span>{matchText}</span>
        {!searching && !line.noCarb && (
          <Button
            variant="secondary"
            size="phone"
            aria-describedby={nameId}
            onClick={() => {
              setSearching(true);
            }}
          >
            {t("change")}
          </Button>
        )}
      </div>
      {searching && (
        <div className={styles.search}>
          <form
            className={styles.searchRow}
            onSubmit={(event) => {
              event.preventDefault();
              void search();
            }}
          >
            <TextInput
              label={t("search", { name: line.name })}
              value={query}
              maxLength={80}
              autoComplete="off"
              onChange={(event) => {
                setQuery(event.target.value);
              }}
            />
            <Button type="submit" variant="secondary" size="phone" disabled={busy || !query.trim()}>
              {t("searchButton")}
            </Button>
            <Button
              variant="secondary"
              size="phone"
              onClick={() => {
                setSearching(false);
                setResults(null);
              }}
            >
              {t("cancelSearch")}
            </Button>
          </form>
          {results && (
            <ul className={styles.results} role="list">
              {results.map((result) => {
                const key =
                  "id" in result.food
                    ? result.food.id
                    : `${result.food.origin}:${result.food.sourceRef}`;
                return (
                  <li key={key}>
                    <button
                      type="button"
                      className={styles.result}
                      aria-label={t("pick", { name: result.food.name })}
                      onClick={() => {
                        pick(result);
                      }}
                    >
                      <span>{result.food.name}</span>
                      <span className={styles.muted}>{result.source}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

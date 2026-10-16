"use client";
import type { ParsedItem, ParsedMeal } from "@frejsi/shared/schemas/ai";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { PortionChips } from "../food/PortionChips";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { NumberInput } from "../ui/NumberInput";
import styles from "./say.module.css";

export function ParsedItems({
  meal,
  onAdd,
  onSearch,
  busy,
}: {
  meal: ParsedMeal;
  onAdd: (items: ParsedItem[]) => void;
  onSearch: (query: string) => void;
  busy: boolean;
}) {
  const t = useTranslations("say");
  const [items, setItems] = useState(meal.items);
  const update = (index: number, item: ParsedItem) => {
    setItems((current) => current.map((row, i) => (i === index ? item : row)));
  };
  const valid = items.every((item) =>
    item.estimate
      ? Number.isInteger(item.estimate.carbs) &&
        item.estimate.carbs >= 0 &&
        item.estimate.carbs <= 500 &&
        (item.estimate.grams === undefined ||
          (item.estimate.grams >= 1 && item.estimate.grams <= 2000))
      : item.match &&
        (item.match.food.portions.some((p) => p.label === item.match?.portionLabel) ||
          (item.match.food.carbsPer100g != null &&
            item.match.grams !== undefined &&
            item.match.grams >= 1 &&
            item.match.grams <= 5000)),
  );
  return (
    <fieldset disabled={busy} className={styles.parsed}>
      {items.map((item, index) => {
        const match = item.match;
        const estimate = item.estimate;
        return (
          <section key={index} className={styles.row}>
            {match && (
              <>
                <h3>{match.food.name}</h3>
                <Badge verified={"verified" in match.food && match.food.verified} />
                <PortionChips
                  desktop
                  portions={match.food.portions.map(({ label, carbs, grams }) => ({
                    label,
                    carbs,
                    ...(grams === undefined ? {} : { grams }),
                  }))}
                  carbsPer100g={match.food.carbsPer100g ?? null}
                  selectedIndex={match.food.portions.findIndex(
                    (p) => p.label === match.portionLabel,
                  )}
                  onSelect={(portion) => {
                    const { grams: _grams, ...rest } = match;
                    update(index, { ...item, match: { ...rest, portionLabel: portion.label } });
                  }}
                  {...(match.grams === undefined ? {} : { grams: match.grams })}
                  onGramsChange={(grams) => {
                    const { portionLabel: _label, grams: _grams, ...rest } = match;
                    update(index, {
                      ...item,
                      match: { ...rest, ...(grams === undefined ? {} : { grams }) },
                    });
                  }}
                />
              </>
            )}
            {estimate && (
              <>
                <h3>{t("estimate", { name: estimate.name, carbs: estimate.carbs })}</h3>
                {estimate.confidence === "low" && (
                  <span className={styles.muted}>{t("uncertain")}</span>
                )}
                <p className={styles.guess}>{t("guess")}</p>
                <div className={styles.amounts}>
                  <NumberInput
                    label={t("grams")}
                    value={estimate.grams ?? ""}
                    min={1}
                    max={2000}
                    step={1}
                    onChange={(event) => {
                      const { grams: _grams, ...rest } = estimate;
                      update(index, {
                        ...item,
                        estimate: {
                          ...rest,
                          ...(event.target.value === ""
                            ? {}
                            : { grams: event.target.valueAsNumber }),
                        },
                      });
                    }}
                  />
                  <NumberInput
                    label={t("carbs")}
                    value={Number.isNaN(estimate.carbs) ? "" : estimate.carbs}
                    min={0}
                    max={500}
                    step={1}
                    onChange={(event) => {
                      update(index, {
                        ...item,
                        estimate: { ...estimate, carbs: event.target.valueAsNumber },
                      });
                    }}
                  />
                </div>
              </>
            )}
            <button
              type="button"
              className={styles.remove}
              disabled={busy}
              onClick={() => {
                setItems((current) => current.filter((_, i) => i !== index));
              }}
            >
              {t("remove")}
            </button>
          </section>
        );
      })}
      {meal.unmatched.map((query, i) => (
        <button
          className={styles.unmatched}
          type="button"
          key={i}
          onClick={() => {
            onSearch(query);
          }}
        >
          {query} · {t("unmatched")}
        </button>
      ))}
      {items.length > 0 && (
        <Button
          size="phone"
          disabled={!valid || busy}
          onClick={() => {
            onAdd(items);
          }}
        >
          {t("add")}
        </Button>
      )}
    </fieldset>
  );
}

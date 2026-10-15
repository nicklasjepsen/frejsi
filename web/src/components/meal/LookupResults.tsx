"use client";
import type {
  FoodCandidate,
  FoodView,
  LookupResponse,
  LookupResult,
} from "@frejsi/shared/schemas/food";
import { useTranslations } from "next-intl";

import { FoodPhoto } from "../food/FoodPhoto";
import { ListRow } from "../ui/ListRow";
import { Notice } from "../ui/Notice";
import styles from "./meal.module.css";
import { useSourceLine } from "./source-line";

const DOWN = new Set(["timeout", "error", "rate-limited"]);

export const isLibraryFood = (food: FoodView | FoodCandidate): food is FoodView => "id" in food;

/**
 * The lookup's answer in the order the server resolved it (own library first, §4), each row with
 * its badge and source line, a notice per source that did not answer, and last the row
 * "Jeg kender tallet selv", which is always there (§4 step 5).
 */
export function LookupResults({
  response,
  query,
  highlighted,
  onPick,
  onManual,
  desktop = false,
}: {
  response: LookupResponse;
  query: string;
  highlighted?: number;
  onPick: (result: LookupResult) => void;
  onManual: () => void;
  desktop?: boolean;
}) {
  const t = useTranslations("log");
  const { line, sourceName } = useSourceLine();
  const down = Object.entries(response.sources).filter(([, status]) => DOWN.has(status));
  const manualName = response.manual.name ?? query.trim();
  return (
    <div className={styles.results} data-testid="lookup-results">
      {desktop ? (
        <p className={styles.resultsMeta}>
          {t("results.desktopCount", { count: response.results.length })}
        </p>
      ) : (
        response.results.length > 0 && <p className={styles.resultsMeta}>{t("results.ownFirst")}</p>
      )}
      {down.map(([id]) => (
        <Notice key={id} tone="sunken" role="status">
          {t("sourceDown", { source: sourceName(id) })}
        </Notice>
      ))}
      <ul className={styles.resultList} role="list">
        {response.results.map((result, index) => {
          const key = isLibraryFood(result.food)
            ? result.food.id
            : `${result.food.origin}:${result.food.sourceRef}`;
          return (
            <li
              key={key}
              className={styles.resultItem}
              data-highlighted={highlighted === index ? "true" : undefined}
            >
              <ListRow
                title={result.food.name}
                verified={result.verified}
                secondary={line(result.food)}
                photo={
                  <FoodPhoto
                    src={isLibraryFood(result.food) ? result.food.photo?.thumbUrl : undefined}
                  />
                }
                onClick={() => {
                  onPick(result);
                }}
              />
            </li>
          );
        })}
        <li
          className={styles.resultItem}
          data-highlighted={highlighted === response.results.length ? "true" : undefined}
        >
          <button type="button" className={styles.manualRow} onClick={onManual}>
            <strong>{t("manual.title")}</strong>
            <span>
              {manualName ? t("manual.subtitle", { q: manualName }) : t("manual.subtitleEmpty")}
            </span>
          </button>
        </li>
      </ul>
    </div>
  );
}

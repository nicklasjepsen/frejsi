"use client";

import { foldForSearch } from "@frejsi/shared/food/search";
import type { FoodView } from "@frejsi/shared/schemas/food";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { PhotoTile } from "@/components/food/PhotoTile";
import { PortionChips, type PortionChoice } from "@/components/food/PortionChips";
import { SearchField } from "@/components/food/SearchField";
import { lookupText } from "@/components/meal/api";
import { EstimateCapture } from "@/components/estimate/EstimateCapture";
import { useEstimateStatus } from "@/components/estimate/useEstimateStatus";
import { setPendingEstimate } from "@/components/estimate/pending";
import { TotalBar } from "@/components/meal/TotalBar";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { localeHref, type AppLocale } from "@/lib/i18n/routing";

import { eatNow, loadPickerFoods, portionCarbs } from "./api";
import styles from "./simple.module.css";

export interface SimplePickerProps {
  spaceId: string;
  locale: AppLocale;
  /** simpleMode: the large sizes of Log-Simpel. Any other session gets the same picker, smaller. */
  simple: boolean;
  /** `?food=<id>` from a "Min mad" tile on Nu: that food arrives selected. */
  initialFoodId?: string | undefined;
}

type Load = { status: "loading" } | { status: "failed" } | { status: "ready"; foods: FoodView[] };

/** The first portion is chosen for a food that has only one; otherwise the child picks. */
const defaultPortion = (food: FoodView): number | null => (food.portions.length === 1 ? 0 : null);

/**
 * Hvad spiser du? (Log-Simpel): the space's verified foods as photo tiles, recently eaten first,
 * the first one spanning both columns. Only verified foods with portions can be logged.
 * The capture tile asks for a fresh photo; the separate link searches the verified list.
 * "Hvor meget?" lives in the sticky footer with the chosen food, so a child who taps a tile in
 * row two never scrolls past the rest of the grid to answer it.
 */
export function SimplePicker({ spaceId, locale, simple, initialFoodId }: SimplePickerProps) {
  const t = useTranslations("eat");
  const router = useRouter();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [portion, setPortion] = useState<number | null>(null);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const aiStatus = useEstimateStatus(spaceId);
  const [aiUnavailable, setAiUnavailable] = useState(false);
  const [found, setFound] = useState<FoodView[] | null>(null);
  const searchVersion = useRef(0);
  async function searchRemote(value: string) {
    const version = ++searchVersion.current;
    if (!value.trim()) {
      setFound(null);
      return;
    }
    try {
      const response = await lookupText(spaceId, value, true);
      if (version !== searchVersion.current) return;
      setFound(
        response.results.flatMap((result) =>
          result.source === "library" &&
          "id" in result.food &&
          result.food.verified &&
          result.food.portions.length > 0
            ? [result.food]
            : [],
        ),
      );
    } catch {
      if (version === searchVersion.current) setFound(null);
    }
  }
  const now = localeHref(locale, "/now");

  const fetchFoods = useCallback(async () => {
    setLoad({ status: "loading" });
    try {
      const foods = await loadPickerFoods(spaceId);
      setLoad({ status: "ready", foods });
      const initial = foods.find((food) => food.id === initialFoodId);
      if (initial) {
        setSelectedId((current) => current ?? initial.id);
        setPortion((current) => current ?? defaultPortion(initial));
      }
    } catch {
      setLoad({ status: "failed" });
    }
  }, [spaceId, initialFoodId]);

  useEffect(() => {
    void fetchFoods();
  }, [fetchFoods]);

  const foods = load.status === "ready" ? load.foods : [];
  const selected = [...foods, ...(found ?? [])].find((food) => food.id === selectedId) ?? null;
  const words = foldForSearch(query).split(/\s+/).filter(Boolean);
  const visible =
    found ??
    (searching && words.length > 0
      ? foods.filter((food) => {
          const name = foldForSearch(food.name);
          return words.every((word) => name.includes(word));
        })
      : foods);
  const carbs = selected && portion !== null ? portionCarbs(selected, portion) : null;
  const choices: PortionChoice[] = (selected?.portions ?? []).map(({ label, carbs, grams }) => ({
    label,
    carbs,
    ...(grams === undefined ? {} : { grams }),
  }));
  const heroSize = simple ? 112 : 104;
  const tileSize = simple ? 104 : 92;

  function choose(food: FoodView) {
    setSelectedId(food.id);
    setPortion(defaultPortion(food));
    setSaveFailed(false);
  }

  async function confirm() {
    if (!selected || portion === null || saving) return;
    setSaving(true);
    setSaveFailed(false);
    try {
      await eatNow(spaceId, selected, portion);
      router.push(now);
    } catch {
      setSaveFailed(true);
      setSaving(false);
    }
  }

  return (
    <div className={styles.page} data-simple={simple} data-testid="eat">
      <PageHeader
        title={t("title")}
        simple={simple}
        onClose={() => {
          router.push(now);
        }}
      />

      {load.status === "loading" && <div aria-busy="true" data-testid="eat-loading" />}

      {load.status === "failed" && (
        <div className={styles.stack}>
          <Notice tone="sunken" role="alert">
            {t("loadFailed")}
          </Notice>
          <Button
            variant="secondary"
            size={simple ? "simple" : "phone"}
            onClick={() => void fetchFoods()}
          >
            {t("retry")}
          </Button>
        </div>
      )}

      {load.status === "ready" && foods.length === 0 && (
        <Notice tone="sunken" data-testid="eat-empty">
          {t("empty")}
        </Notice>
      )}

      {load.status === "ready" && (
        <>
          {searching && (
            <div className={styles.search}>
              <SearchField
                label={t("searchLabel")}
                placeholder={t("searchLabel")}
                value={query}
                onChange={(value) => {
                  searchVersion.current++;
                  setFound(null);
                  setQuery(value);
                }}
                onSubmit={(value) => void searchRemote(value)}
              />
            </div>
          )}
          {visible.length === 0 && <p className={styles.noMatch}>{t("noMatch")}</p>}
          <div className={styles.grid} data-testid="eat-grid">
            {visible.map((food, index) => {
              const hero = index === 0 && !searching;
              return (
                <div key={food.id} className={hero ? styles.hero : styles.cell}>
                  <PhotoTile
                    title={food.name}
                    {...(food.photo ? { thumbUrl: food.photo.thumbUrl } : {})}
                    verified={food.verified}
                    selected={food.id === selectedId}
                    size={hero ? heroSize : tileSize}
                    onClick={() => {
                      choose(food);
                    }}
                  />
                </div>
              );
            })}
            {!searching && aiStatus?.available && !aiUnavailable && (
              <EstimateCapture
                spaceId={spaceId}
                simple={simple}
                tile
                onUnavailable={() => {
                  setAiUnavailable(true);
                }}
                onEstimate={(estimate, photoDataUrl) => {
                  setPendingEstimate({ spaceId, estimate, photoDataUrl });
                  router.push(localeHref(locale, "/ask"));
                }}
              />
            )}
          </div>
          {!searching && (
            <button
              type="button"
              className={styles.searchLink}
              onClick={() => {
                setSearching(true);
              }}
            >
              {t("findOther")}
            </button>
          )}
        </>
      )}

      {saveFailed && (
        <Notice tone="sunken" role="alert">
          {t("saveFailed")}
        </Notice>
      )}

      {/* The footer: "Hvor meget?" right over the chosen food, so the chips are never below the grid. */}
      {selected && (
        <div className={styles.bar} data-testid="eat-footer">
          {selected.portions.length > 1 && (
            <section className={styles.portions} aria-label={t("howMuch")}>
              <h2 className={styles.howMuch}>{t("howMuch")}</h2>
              <PortionChips
                portions={choices}
                carbsPer100g={null}
                {...(portion !== null ? { selectedIndex: portion } : {})}
                onSelect={(choice) => {
                  const index = choices.indexOf(choice);
                  setPortion(index >= 0 ? index : null);
                  setSaveFailed(false);
                }}
              />
            </section>
          )}
          <TotalBar
            name={selected.name}
            total={carbs}
            actionLabel={saving ? t("saving") : t("confirm")}
            onAction={() => void confirm()}
            disabled={carbs === null || saving}
            {...(simple ? { size: "simple" as const } : {})}
          />
        </div>
      )}
    </div>
  );
}

"use client";

import { foldForSearch } from "@frejsi/shared/food/search";
import type { FoodView } from "@frejsi/shared/schemas/food";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { PhotoTile } from "@/components/food/PhotoTile";
import { PortionChips, type PortionChoice } from "@/components/food/PortionChips";
import { SearchField } from "@/components/food/SearchField";
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
 * the first one spanning both columns. Tapping selects; a food with several portions asks "Hvor
 * meget?"; "Ja, det spiser jeg" saves one meal through `POST meals` and goes back to Nu. "Noget
 * andet?" searches the same verified list (the photo path is v0.4.0). There is no bolus control
 * here for anyone, and nothing unverified can be shown: the list is `GET foods`, which the route
 * filters for a simpleMode session, filtered again to verified foods (spec §2).
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
  const selected = foods.find((food) => food.id === selectedId) ?? null;
  const words = foldForSearch(query).split(/\s+/).filter(Boolean);
  const visible =
    searching && words.length > 0
      ? foods.filter((food) => {
          const name = foldForSearch(food.name);
          return words.every((word) => name.includes(word));
        })
      : foods;
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

      {load.status === "ready" && foods.length > 0 && (
        <>
          {searching && (
            <div className={styles.search}>
              <SearchField
                label={t("searchLabel")}
                placeholder={t("searchLabel")}
                value={query}
                onChange={setQuery}
                onSubmit={setQuery}
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
            {!searching && (
              <button
                type="button"
                className={styles.other}
                onClick={() => {
                  setSearching(true);
                }}
              >
                <svg width="40" height="40" viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="10" cy="10" r="6" fill="none" stroke="currentColor" strokeWidth="2" />
                  <path
                    d="m15 15 5 5"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
                {t("somethingElse")}
              </button>
            )}
          </div>
        </>
      )}

      {selected && selected.portions.length > 1 && (
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

      {saveFailed && (
        <Notice tone="sunken" role="alert">
          {t("saveFailed")}
        </Notice>
      )}

      {selected && (
        <div className={styles.bar}>
          <TotalBar
            name={selected.name}
            total={carbs ?? 0}
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

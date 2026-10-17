"use client";
import type { RecipeParseRequest } from "@frejsi/shared/schemas/ai";
import type { ApiErrorCode } from "@frejsi/shared/schemas/api";
import type { RecipeReview as Review } from "@frejsi/shared/schemas/food";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { useEstimateStatus } from "@/components/estimate/useEstimateStatus";
import { libraryApi } from "@/components/library/api-client";
import { Button, Notice, PageHeader } from "@/components/ui";
import { localeHref, type AppLocale } from "@/lib/i18n/routing";
import type { SharedRecipe } from "@/lib/recipes/contracts";

import { recipeApi, RecipeApiError } from "./api";
import { RecipeEntry, type EntryInitial } from "./RecipeEntry";
import { RecipeReview } from "./RecipeReview";
import styles from "./recipes.module.css";

interface Loaded {
  review: Review;
  photoDataUrl?: string | undefined;
  portionLabels?: { one: string; half: string } | undefined;
}

/**
 * `/recipe/new` and `/recipe/[foodId]` (plan §6): the ways in, then the review form. `meal`
 * opens a logged meal's items as lines ("Gem som opskrift"); `share` loads the phone's share
 * once; `foodId` edits a saved dish. Nothing reaches a model before the person's tap.
 */
export function RecipeScreen({
  spaceId,
  locale,
  mealId,
  shareId,
  foodId,
}: {
  spaceId: string;
  locale: AppLocale;
  mealId?: string | undefined;
  shareId?: string | undefined;
  foodId?: string | undefined;
}) {
  const t = useTranslations("recipe");
  const errors = useTranslations("errors.api");
  const router = useRouter();
  const status = useEstimateStatus(spaceId);
  const preloading = Boolean(mealId ?? shareId ?? foodId);
  const [loading, setLoading] = useState(preloading);
  const [loadFailed, setLoadFailed] = useState<ApiErrorCode | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [initial, setInitial] = useState<EntryInitial & { photoDataUrl?: string | undefined }>({});
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<ApiErrorCode | null>(null);

  useEffect(() => {
    if (!preloading) return;
    let live = true;
    setLoading(true);
    setLoadFailed(null);
    const load = async (): Promise<Loaded | SharedRecipe> => {
      if (foodId) {
        const food = await libraryApi.get(spaceId, foodId);
        if (!food.recipe) throw new RecipeApiError(400, "validation");
        const review: Review = {
          title: food.name.slice(0, 120),
          lines: food.recipe.ingredients,
          totalCarbs: food.recipe.ingredients.reduce((sum, line) => sum + line.carbs, 0),
          ...(food.recipe.yieldPortions === undefined
            ? {}
            : { yieldPortions: food.recipe.yieldPortions }),
          ...(food.recipe.yieldGrams === undefined ? {} : { yieldGrams: food.recipe.yieldGrams }),
          source: food.recipe.source,
          approx: false,
        };
        const [one, half] = food.portions;
        return {
          review,
          ...(one && half ? { portionLabels: { one: one.label, half: half.label } } : {}),
        };
      }
      if (mealId) return { review: await recipeApi.fromMeal(spaceId, mealId) };
      // A share is prefilled only; the page or the text reaches a model on the tap, not here.
      return recipeApi.takeShare(shareId ?? "");
    };
    load()
      .then((result) => {
        if (!live) return;
        if ("review" in result) setLoaded(result);
        else setInitial({ text: result.text, url: result.url, photoDataUrl: result.photoDataUrl });
        setLoading(false);
      })
      .catch((error: unknown) => {
        if (!live) return;
        setLoadFailed(error instanceof RecipeApiError ? error.code : "internal");
        setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [spaceId, mealId, shareId, foodId, preloading, attempt]);

  async function read(request: RecipeParseRequest, photoDataUrl?: string) {
    if (busy) return;
    setBusy(true);
    setFailed(null);
    try {
      const review = await recipeApi.parse(spaceId, request);
      setLoaded({ review, photoDataUrl });
    } catch (error) {
      setFailed(error instanceof RecipeApiError ? error.code : "internal");
    } finally {
      setBusy(false);
    }
  }

  const back = () => {
    router.push(localeHref(locale, "/library"));
  };
  return (
    <section className={styles.screen} data-testid="recipe-screen">
      <PageHeader title={t(foodId ? "editTitle" : "title")} onBack={back} />
      {loading && (
        <p className={styles.muted} aria-busy="true">
          {t("loading")}
        </p>
      )}
      {loadFailed && (
        <div role="alert">
          <Notice tone="sunken">
            {loadFailed === "share-expired" ? errors("share-expired") : t("loadFailed")}
          </Notice>
          {loadFailed !== "share-expired" && (
            <Button
              variant="secondary"
              size="phone"
              onClick={() => {
                setAttempt((value) => value + 1);
              }}
            >
              {t("retry")}
            </Button>
          )}
        </div>
      )}
      {!loading && !loadFailed && !loaded && (
        <>
          {shareId && <p className={styles.muted}>{t("entry.shared")}</p>}
          {initial.photoDataUrl && (
            <Button
              variant="secondary"
              disabled={busy || !status?.available}
              onClick={() => {
                const photoDataUrl = initial.photoDataUrl;
                if (photoDataUrl) void read({ photoDataUrl }, photoDataUrl);
              }}
            >
              {t("entry.read")}
            </Button>
          )}
          <RecipeEntry
            locale={locale}
            aiAvailable={status?.available ?? false}
            busy={busy || status === null}
            initial={initial}
            onSubmit={(request, photoDataUrl) => void read(request, photoDataUrl)}
          />
          {failed && (
            <Notice tone="sunken" role="alert">
              {errors(failed)}
            </Notice>
          )}
        </>
      )}
      {!loading && loaded && (
        <>
          {mealId && <p className={styles.muted}>{t("entry.fromMeal")}</p>}
          <RecipeReview
            key={loaded.review.title + String(loaded.review.lines.length)}
            spaceId={spaceId}
            locale={locale}
            review={loaded.review}
            photoDataUrl={loaded.photoDataUrl}
            foodId={foodId}
            portionLabels={loaded.portionLabels}
          />
        </>
      )}
    </section>
  );
}

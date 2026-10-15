"use client";

import type { MealView } from "@frejsi/shared/schemas/meal";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback } from "react";

import { FoodPhoto } from "@/components/food/FoodPhoto";
import { Button } from "@/components/ui";
import { formatClock } from "@/lib/i18n/time";
import { localeHref, type AppLocale } from "@/lib/i18n/routing";
import { useLiveFeed } from "@/lib/live/useLiveFeed";

import { fetchMeal } from "./api";
import { useItemLine } from "./MealItems";
import styles from "./meal-detail.module.css";
import { useMealResource } from "./useMealResource";

export interface SimpleMealViewProps {
  spaceId: string;
  mealId: string;
  locale: AppLocale;
  timeZone: string;
}

/**
 * The child's meal (Maaltid-Simpel, the non-AI part; decision 9): "Du spiste kl. 12:10", the
 * photo, the dish, the items and the total. No curve, no numbers about glucose, no edit and no
 * delete. It reads `GET meals/[id]`, which carries no glucose, so none reaches this view at all.
 */
export function SimpleMealView({ spaceId, mealId, locale, timeZone }: SimpleMealViewProps) {
  const t = useTranslations("mealDetail");
  const kit = useTranslations("foodKit");
  const router = useRouter();
  const feed = useLiveFeed(spaceId, { readings: false });
  const home = localeHref(locale, "/now");
  const toNow = useCallback(() => {
    router.push(home);
  }, [router, home]);
  const load = useCallback(
    (signal: AbortSignal) => fetchMeal(spaceId, mealId, signal),
    [spaceId, mealId],
  );
  const { state, retry } = useMealResource(load, mealId, feed, {
    onDeleted: toNow,
    onSpaceUpdated: () => {
      router.refresh();
    },
  });
  const meal = state.status === "ready" ? state.data : null;
  return (
    <div className={styles.simple} data-testid="simple-meal">
      <header className={styles.simpleHeader}>
        <Link href={home} className={styles.simpleBack} aria-label={kit("back")}>
          <svg width="24" height="24" viewBox="0 0 20 20" aria-hidden="true">
            <path
              d="M13 4 L7 10 L13 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Link>
        {meal && (
          <h1 className={styles.simpleHeading}>
            {t("simple.youAte", { time: formatClock(new Date(meal.ts), timeZone) })}
          </h1>
        )}
        <span className={styles.simpleSpacer} aria-hidden="true" />
      </header>
      {meal ? (
        <SimpleMeal meal={meal} />
      ) : state.status === "loading" ? (
        <div className={styles.simplePhoto} aria-busy="true" aria-label={t("loading")} />
      ) : (
        <div className={styles.message} role="status">
          <p>{state.status === "not-found" ? t("notFound") : t("failed")}</p>
          {state.status === "failed" && (
            <Button variant="secondary" size="simple" onClick={retry}>
              {t("retry")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function SimpleMeal({ meal }: { meal: MealView }) {
  const t = useTranslations("mealDetail");
  const line = useItemLine();
  return (
    <>
      <span className={styles.simplePhoto}>
        <FoodPhoto src={meal.photo?.originalUrl ?? meal.photo?.thumbUrl} alt={meal.title} />
      </span>
      <div className={styles.simpleCard}>
        <h2 className={styles.simpleTitle}>{meal.title}</h2>
        <ul className={styles.simpleItems}>
          {meal.items.map((item, index) => (
            <li key={index}>
              <span className={styles.simpleName}>{line(item)}</span>
              <span className={styles.simpleAmount}>{t("grams", { grams: item.carbs })}</span>
            </li>
          ))}
        </ul>
        <p className={styles.simpleTotal}>
          <span>{t("total")}</span>
          <span className={styles.simpleTotalValue}>
            {t("simple.total", { grams: meal.totalCarbs })}
          </span>
        </p>
      </div>
    </>
  );
}

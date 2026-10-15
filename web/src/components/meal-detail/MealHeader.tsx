"use client";

import type { MealView } from "@frejsi/shared/schemas/meal";
import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { FoodPhoto } from "@/components/food/FoodPhoto";
import { useNow } from "@/components/glucose/useNow";
import { Button, Kbd, PageHeader } from "@/components/ui";
import { resolveLocale } from "@/lib/i18n/routing";

import { desktopMeta, phoneMeta } from "./format";
import styles from "./meal-detail.module.css";

interface HeaderProps {
  meal: MealView;
  timeZone: string;
  onEdit: () => void;
  saveDish?: ReactNode;
}

/**
 * Maaltid-Telefon: the "meta" header (back, "I dag 12:10 · Jonas", "Ret"), then the 72 px photo,
 * the serif title and "50 g kulhydrat · 3 ting".
 */
export function PhoneMealHeader({
  meal,
  timeZone,
  onEdit,
  backHref,
}: HeaderProps & {
  backHref: string;
}) {
  const t = useTranslations("mealDetail");
  const stats = useTranslations("stats");
  const locale = resolveLocale(useLocale());
  const now = useNow();
  return (
    <>
      <div className={styles.metaHeader}>
        <PageHeader
          variant="meta"
          meta={phoneMeta(t, stats, meal, now, timeZone, locale)}
          backHref={backHref}
          trailing={
            <button type="button" className={styles.editLink} onClick={onEdit}>
              {t("edit")}
            </button>
          }
        />
      </div>
      <div className={styles.hero}>
        <span className={styles.heroPhoto}>
          <FoodPhoto src={meal.photo?.thumbUrl} alt={meal.title} size={72} />
        </span>
        <div className={styles.heroText}>
          <h1 className={styles.title}>{meal.title}</h1>
          <p className={styles.summary}>
            {t("summary", { carbs: meal.totalCarbs, count: meal.items.length })}
          </p>
        </div>
      </div>
    </>
  );
}

/**
 * Maaltid-Desktop: the 180 px photo banner, the 26 px serif title, "Onsdag 14. oktober · 12:10 ·
 * logget af Jonas" and the 36 px "Ret" with its key.
 */
export function DesktopMealHeader({ meal, timeZone, onEdit, saveDish }: HeaderProps) {
  const t = useTranslations("mealDetail");
  const locale = resolveLocale(useLocale());
  return (
    <div className={styles.banner}>
      <span className={styles.bannerPhoto}>
        <FoodPhoto src={meal.photo?.originalUrl ?? meal.photo?.thumbUrl} alt={meal.title} />
      </span>
      <div className={styles.bannerText}>
        <h1 className={styles.title} data-size="desktop">
          {meal.title}
        </h1>
        <p className={styles.meta}>{desktopMeta(t, meal, timeZone, locale)}</p>
        <div className={styles.actions}>
          <Button variant="secondary" onClick={onEdit}>
            {t("edit")}
            <Kbd>{t("editKey")}</Kbd>
          </Button>
          {saveDish}
        </div>
      </div>
    </div>
  );
}

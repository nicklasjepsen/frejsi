"use client";

import { formatUnits } from "@frejsi/shared/pump/units";
import type { MealView } from "@frejsi/shared/schemas/meal";
import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { FoodPhoto } from "@/components/food/FoodPhoto";
import { useNow } from "@/components/glucose/useNow";
import { Button, Kbd, PageHeader } from "@/components/ui";
import kit from "@/components/ui/food-ui.module.css";
import { resolveLocale } from "@/lib/i18n/routing";
import { formatClock } from "@/lib/i18n/time";

import { desktopMeta, phoneMeta } from "./format";
import styles from "./meal-detail.module.css";
import { SaveAsRecipe } from "./SaveAsRecipe";

interface HeaderProps {
  meal: MealView;
  timeZone: string;
  onEdit: () => void;
  /** `SaveAsDish`, mounted by `MealDetail`. */
  saveDish?: ReactNode;
  /**
   * The second action of the row, after `SaveAsDish`: `SaveAsRecipe` (#200) unless the caller
   * gives something else here (v0.6.0 task 5 mounts it on both layouts).
   */
  saveRecipe?: ReactNode;
  /** "Det passer" for a meal the pump record made (v0.7.0 plan §9), right after the edit button. */
  adopt?: ReactNode;
}

/**
 * "Bolus 11:58 · 2,4 E": what the pump delivered for this meal, beside its time, as history. Only
 * when the meal's bolus came from the pump record; the API sends units to owners and carers
 * outside simpleMode only. Nothing here is computed: the number is the pump's.
 */
function PumpBolusLine({
  meal,
  timeZone,
  className,
}: {
  meal: MealView;
  timeZone: string;
  className: string | undefined;
}) {
  const t = useTranslations("pumpMeal");
  const locale = resolveLocale(useLocale());
  if (meal.bolusUnits === undefined || meal.bolusTs === undefined) return null;
  return (
    <p className={className} data-testid="meal-bolus">
      {t("bolus", {
        time: formatClock(new Date(meal.bolusTs), timeZone),
        units: formatUnits(meal.bolusUnits, locale),
      })}
    </p>
  );
}

/** "Fra pumpen · ikke tjekket" until a person ticks "Det passer" or edits the meal. */
function PumpBadge({ meal }: { meal: MealView }) {
  const t = useTranslations("pumpMeal");
  if (!meal.fromPump) return null;
  return (
    <span className={`${kit.theme ?? ""} ${kit.badge ?? ""}`} data-variant="unverified">
      {t("badge")}
    </span>
  );
}

/**
 * Maaltid-Telefon: the "meta" header (back, "I dag 12:10 · Jonas"), then the 72 px photo, the
 * serif title and "50 g kulhydrat · 3 ting", and the action row: the 44 px "Ret måltid" button,
 * "Gem som egen ret" and the optional second action (v0.6.0 task 8).
 */
export function PhoneMealHeader({
  meal,
  timeZone,
  onEdit,
  backHref,
  saveDish,
  saveRecipe,
  adopt,
}: HeaderProps & {
  backHref: string;
}) {
  const t = useTranslations("mealDetail");
  const pump = useTranslations("pumpMeal");
  const stats = useTranslations("stats");
  const locale = resolveLocale(useLocale());
  const now = useNow();
  const summary = t("summary", { carbs: meal.totalCarbs, count: meal.items.length });
  return (
    <>
      <div className={styles.metaHeader}>
        <PageHeader
          variant="meta"
          meta={phoneMeta(t, stats, meal, now, timeZone, locale)}
          backHref={backHref}
        />
      </div>
      <div className={styles.hero}>
        <span className={styles.heroPhoto}>
          <FoodPhoto src={meal.photo?.thumbUrl} alt={meal.title} size={72} />
        </span>
        <div className={styles.heroText}>
          <h1 className={styles.title}>{meal.title}</h1>
          <p className={styles.summary}>
            {meal.pumpCarbs === undefined
              ? summary
              : pump("besideTotal", { total: summary, grams: meal.pumpCarbs })}
          </p>
          <PumpBolusLine meal={meal} timeZone={timeZone} className={styles.summary} />
          <PumpBadge meal={meal} />
        </div>
      </div>
      <div className={styles.phoneActions} data-testid="meal-actions">
        <Button variant="secondary" onClick={onEdit}>
          {t("editMeal")}
        </Button>
        {adopt}
        {saveDish}
        {saveRecipe ?? <SaveAsRecipe meal={meal} locale={locale} />}
      </div>
    </>
  );
}

/**
 * Maaltid-Desktop: the 180 px photo banner, the 26 px serif title, "Onsdag 14. oktober · 12:10 ·
 * logget af Jonas" and the 36 px "Ret" with its key.
 */
export function DesktopMealHeader({
  meal,
  timeZone,
  onEdit,
  saveDish,
  saveRecipe,
  adopt,
}: HeaderProps) {
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
        <PumpBolusLine meal={meal} timeZone={timeZone} className={styles.meta} />
        <PumpBadge meal={meal} />
        <div className={styles.actions} data-testid="meal-actions">
          <Button variant="secondary" onClick={onEdit}>
            {t("edit")}
            <Kbd>{t("editKey")}</Kbd>
          </Button>
          {adopt}
          {saveDish}
          {saveRecipe ?? <SaveAsRecipe meal={meal} locale={locale} />}
        </div>
      </div>
    </div>
  );
}

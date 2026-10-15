"use client";
import type { MealCurveView } from "@frejsi/shared/schemas/history";
import { useTranslations } from "next-intl";
import Link from "next/link";

import { ArrowNav } from "@/components/ui";
import { localeHref, type AppLocale } from "@/lib/i18n/routing";

import styles from "./meal-detail.module.css";

export function MealNav({
  view,
  locale,
  timeZone,
  onOpen,
}: {
  view: MealCurveView;
  locale: AppLocale;
  timeZone: string;
  onOpen: (id: string) => void;
}) {
  const t = useTranslations("mealDetail");
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(view.meal.ts));
  const { previousMealId, nextMealId } = view.neighbours;
  return (
    <div className={styles.detailNav}>
      <Link href={localeHref(locale, `/history?date=${date}`)}>{t("history")}</Link>
      <ArrowNav
        label={t("nav.label")}
        previous={{
          label: t("nav.previous"),
          disabled: !previousMealId,
          onClick: () => {
            if (previousMealId) onOpen(previousMealId);
          },
        }}
        next={{
          label: t("nav.next"),
          disabled: !nextMealId,
          onClick: () => {
            if (nextMealId) onOpen(nextMealId);
          },
        }}
      />
    </div>
  );
}

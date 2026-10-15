"use client";

import type { Role } from "@frejsi/shared";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Notice } from "@/components/ui/Notice";
import { localeHref, type AppLocale } from "@/lib/i18n/routing";

import styles from "./shell.module.css";
import type { SoonFeature } from "./soon-features";

/**
 * "Kommer i en senere version": a calm page, nothing drawn empty. For a viewer, `today` is the
 * I dag page: the notice that blood sugar is not shown here and the meals placeholder (decision 16).
 */
export function SoonPage({
  locale,
  feature,
  role,
}: {
  locale: AppLocale;
  feature: SoonFeature | null;
  role: Role;
}) {
  const t = useTranslations("soon");
  const viewer = useTranslations("viewer");

  if (role === "viewer" && feature === "today") {
    return (
      <div className={styles.calmPage}>
        <h1>{viewer("todayTitle")}</h1>
        <Card>
          <Notice>{viewer("mealsSoon")}</Notice>
        </Card>
        <Notice tone="sunken">{viewer("notice")}</Notice>
      </div>
    );
  }

  return (
    <div className={styles.calmPage}>
      {feature && <p className={styles.calmLead}>{t(`feature.${feature}`)}</p>}
      <h1>{t("title")}</h1>
      <p>{t("body")}</p>
      {role !== "viewer" && (
        <div className={styles.calmActions}>
          <Button href={localeHref(locale, "/now")} variant="secondary">
            {t("backToNow")}
          </Button>
        </div>
      )}
    </div>
  );
}

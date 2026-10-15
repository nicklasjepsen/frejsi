"use client";
import type { FoodView } from "@frejsi/shared/schemas/food";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Button, PageHeader } from "@/components/ui";
import { localeHref, type AppLocale } from "@/lib/i18n/routing";

import { libraryApi } from "./api-client";
import { FoodForm } from "./FoodForm";
import styles from "./library.module.css";

/**
 * The phone's food page (no artboard; design gap): `library/new` and `library/[foodId]`, built
 * from the desktop edit panel's fields. Saving returns to the list, which reloads from the API.
 */
export function FoodEditScreen({
  spaceId,
  locale,
  foodId,
}: {
  spaceId: string;
  locale: AppLocale;
  foodId?: string;
}) {
  const t = useTranslations("library");
  const router = useRouter();
  const [food, setFood] = useState<FoodView>();
  const [status, setStatus] = useState<"loading" | "ready" | "error">(foodId ? "loading" : "ready");
  const [attempt, setAttempt] = useState(0);
  const back = () => {
    router.push(localeHref(locale, "/library"));
  };

  useEffect(() => {
    if (!foodId) return;
    let live = true;
    setStatus("loading");
    libraryApi
      .get(spaceId, foodId)
      .then((loaded) => {
        if (!live) return;
        setFood(loaded);
        setStatus("ready");
      })
      .catch(() => {
        if (live) setStatus("error");
      });
    return () => {
      live = false;
    };
  }, [spaceId, foodId, attempt]);

  return (
    <section className={styles.editPage} data-testid="food-edit">
      <PageHeader title={t(foodId ? "form.editTitle" : "form.newTitle")} onBack={back} />
      {status === "loading" && <p className={styles.muted} aria-busy="true" />}
      {status === "error" && (
        <div className={styles.state} role="alert">
          <p>{t("form.loadFailed")}</p>
          <Button
            variant="secondary"
            size="phone"
            onClick={() => {
              setAttempt((value) => value + 1);
            }}
          >
            {t("retry")}
          </Button>
        </div>
      )}
      {status === "ready" && (
        <FoodForm spaceId={spaceId} {...(food ? { food } : {})} onSaved={back} />
      )}
    </section>
  );
}

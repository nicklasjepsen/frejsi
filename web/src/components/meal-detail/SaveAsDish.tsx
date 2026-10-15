"use client";

import { foldForSearch } from "@frejsi/shared/food/search";
import type { MealView } from "@frejsi/shared/schemas/meal";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRef, useState } from "react";

import { libraryApi } from "@/components/library/api-client";
import { TextInput } from "@/components/ui/TextInput";
import { Button } from "@/components/ui";
import { localeHref, type AppLocale } from "@/lib/i18n/routing";

import styles from "./meal-detail.module.css";

export function SaveAsDish({
  spaceId,
  meal,
  locale,
}: {
  spaceId: string;
  meal: MealView;
  locale: AppLocale;
}) {
  const t = useTranslations("mealDetail.dish");
  const boundedName = (title: string) => {
    let value = title.trim().slice(0, 200);
    while (foldForSearch(value).length > 200) value = value.slice(0, -1);
    return value.trim();
  };
  const [name, setName] = useState<string | null>(null);
  const needsName = boundedName(meal.title) !== meal.title;
  const dishName = needsName ? (name ?? boundedName(meal.title)).trim() : meal.title;
  const validName =
    dishName.length > 0 && dishName.length <= 200 && foldForSearch(dishName).length <= 200;
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);
  // A failed photo copy retries just that step. A successful create must never be repeated.
  const created = useRef<{ id: string; hasPhoto: boolean } | null>(null);
  const locked = useRef(false);
  async function save() {
    if (locked.current || saved || !validName) return;
    locked.current = true;
    setBusy(true);
    setFailed(false);
    try {
      if (!created.current) {
        const food = await libraryApi.create(
          spaceId,
          {
            name: dishName,
            portions: [{ label: t("portion"), carbs: meal.totalCarbs }],
          },
          { verify: false },
        );
        created.current = {
          id: food.id,
          hasPhoto: meal.photo !== undefined,
        };
      }
      const { id, hasPhoto } = created.current;
      if (hasPhoto) {
        const response = await fetch(
          `${localeHref(locale, `/meal/${encodeURIComponent(meal.id)}/photo`)}?${new URLSearchParams({ space: spaceId })}`,
          { credentials: "same-origin", cache: "no-store" },
        );
        if (!response.ok) throw new Error("photo");
        await libraryApi.putPhoto(spaceId, id, new Uint8Array(await response.arrayBuffer()));
      }
      setSaved(true);
    } catch {
      setFailed(true);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <div className={styles.saveDish}>
      {needsName && (
        <TextInput
          label={t("name")}
          maxLength={200}
          value={name ?? boundedName(meal.title)}
          disabled={busy || saved || created.current !== null}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
      )}
      <Button
        variant="secondary"
        disabled={busy || saved || !validName}
        onClick={() => void save()}
      >
        {t("save")}
      </Button>
      {failed && <p role="alert">{t("failed")}</p>}
      {saved && <Link href={localeHref(locale, "/library?filter=unverified")}>{t("saved")}</Link>}
    </div>
  );
}

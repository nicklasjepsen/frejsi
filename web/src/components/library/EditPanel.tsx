"use client";
import type { FoodView } from "@frejsi/shared/schemas/food";
import { useTranslations } from "next-intl";

import { FoodForm } from "./FoodForm";
import styles from "./library.module.css";

/** Bibliotek-Desktop's right-hand panel: the food form for the row being edited, or a new food. */
export function EditPanel({
  spaceId,
  food,
  onSaved,
  onClose,
}: {
  spaceId: string;
  food?: FoodView;
  onSaved: (food: FoodView, previous?: FoodView) => void;
  onClose: () => void;
}) {
  const t = useTranslations("library.form");
  return (
    <aside className={styles.panel} data-testid="edit-panel">
      <button type="button" className={styles.panelClose} aria-label={t("close")} onClick={onClose}>
        <span aria-hidden="true">×</span>
      </button>
      <FoodForm spaceId={spaceId} {...(food ? { food } : {})} onSaved={onSaved} />
    </aside>
  );
}

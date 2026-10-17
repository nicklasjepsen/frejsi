"use client";
import { useTranslations } from "next-intl";

import styles from "./history.module.css";

/** A failed read of the symptoms, said plainly with a retry, never shown as "none" (plan §5). */
export function SymptomsFailed({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations("history");
  return (
    <p className={styles.muted} role="alert" data-testid="symptoms-failed">
      {t("symptomsFailed")}{" "}
      <button type="button" onClick={onRetry}>
        {t("retry")}
      </button>
    </p>
  );
}

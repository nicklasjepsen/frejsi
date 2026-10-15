"use client";
import { useTranslations } from "next-intl";

import { formatClock } from "@/lib/i18n/time";

import styles from "./meal.module.css";

/**
 * "Bolus givet nu": records a time and nothing else (§0, §5, decision 1). There is no field for an
 * amount, a unit or a ratio, and no way to add one. Once tapped it reads "Bolus 11:58" with an
 * undo. The caller leaves it out for a simpleMode session.
 */
export function BolusTap({
  bolusTs,
  timeZone,
  onTap,
  onUndo,
}: {
  bolusTs: string | null;
  timeZone: string;
  onTap: () => void;
  onUndo: () => void;
}) {
  const t = useTranslations("log.bolus");
  return (
    <div className={styles.bolus}>
      {bolusTs ? (
        <div className={styles.bolusDone} data-testid="bolus-done">
          <BolusIcon />
          <span>{t("at", { time: formatClock(new Date(bolusTs), timeZone) })}</span>
          <button
            type="button"
            className={styles.linkButton}
            onClick={() => {
              onUndo();
            }}
          >
            {t("undo")}
          </button>
        </div>
      ) : (
        <button
          type="button"
          className={styles.bolusButton}
          onClick={() => {
            onTap();
          }}
        >
          <BolusIcon />
          <span className={styles.bolusLabel}>{t("button")}</span>
        </button>
      )}
      <p className={styles.bolusNote}>{t("note")}</p>
    </div>
  );
}

function BolusIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <circle
        cx="10"
        cy="10"
        r="7.5"
        fill="none"
        stroke="var(--meal-bolus-marker)"
        strokeWidth="1.8"
      />
      <path
        d="M10 6 V10 L13 12"
        fill="none"
        stroke="var(--meal-bolus-marker)"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

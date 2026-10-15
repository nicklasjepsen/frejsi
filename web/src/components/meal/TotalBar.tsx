"use client";
import { useLocale, useTranslations } from "next-intl";

import { Kbd } from "../ui/Kbd";
import styles from "./meal.module.css";

/**
 * The sticky "I alt · 50 g kulhydrat · Gem måltid" bar (Log-Portioner, Log-Desktop). With `name`
 * it is the simple variant of Log-Simpel: the dish name over "42 g kulhydrat" and the large
 * "Ja, det spiser jeg" (`size` "simple" in simpleMode).
 */
export function TotalBar({
  total,
  actionLabel,
  onAction,
  disabled = false,
  shortcut,
  name,
  size,
}: {
  total: number;
  actionLabel: string;
  onAction: () => void;
  disabled?: boolean;
  shortcut?: string;
  /** The simple variant: the chosen dish in place of "I alt". */
  name?: string;
  size?: "simple";
}) {
  const t = useTranslations("log");
  const locale = useLocale();
  const amount = (
    <span className={styles.totalAmount}>
      {t("totalAmount", {
        amount: new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(total),
      })}{" "}
      <span className={styles.totalUnit}>{t("carbs")}</span>
    </span>
  );
  if (name !== undefined) {
    return (
      <div
        className={`${styles.totalBar} ${styles.totalBarSimple}`}
        data-testid="total-bar"
        data-variant="simple"
        data-size={size}
      >
        <div className={styles.totalSimpleLine}>
          <span className={styles.totalName}>{name}</span>
          {amount}
        </div>
        <button
          type="button"
          className={`${styles.saveButton} ${styles.confirmButton}`}
          onClick={onAction}
          disabled={disabled}
        >
          <svg width="28" height="28" viewBox="0 0 34 34" aria-hidden="true">
            <path
              d="M8 18 L14 24 L26 10"
              fill="none"
              stroke="currentColor"
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {actionLabel}
        </button>
      </div>
    );
  }
  return (
    <div className={styles.totalBar} data-testid="total-bar">
      <div className={styles.totalText}>
        <span className={styles.totalLabel}>{t("total")}</span>
        {amount}
      </div>
      <button type="button" className={styles.saveButton} onClick={onAction} disabled={disabled}>
        {actionLabel}
        {shortcut && <Kbd>{shortcut}</Kbd>}
      </button>
    </div>
  );
}

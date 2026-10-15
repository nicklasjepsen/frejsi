"use client";
import { useLocale, useTranslations } from "next-intl";

import { Kbd } from "../ui/Kbd";
import styles from "./meal.module.css";

/** The sticky "I alt · 50 g kulhydrat · Gem måltid" bar (Log-Portioner, Log-Desktop). */
export function TotalBar({
  total,
  actionLabel,
  onAction,
  disabled = false,
  shortcut,
}: {
  total: number;
  actionLabel: string;
  onAction: () => void;
  disabled?: boolean;
  shortcut?: string;
}) {
  const t = useTranslations("log");
  const locale = useLocale();
  return (
    <div className={styles.totalBar} data-testid="total-bar">
      <div className={styles.totalText}>
        <span className={styles.totalLabel}>{t("total")}</span>
        <span className={styles.totalAmount}>
          {t("totalAmount", {
            amount: new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(total),
          })}{" "}
          <span className={styles.totalUnit}>{t("carbs")}</span>
        </span>
      </div>
      <button type="button" className={styles.saveButton} onClick={onAction} disabled={disabled}>
        {actionLabel}
        {shortcut && <Kbd>{shortcut}</Kbd>}
      </button>
    </div>
  );
}

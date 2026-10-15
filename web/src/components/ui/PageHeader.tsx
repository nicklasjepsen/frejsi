"use client";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import styles from "./food-ui.module.css";

export function PageHeader({
  title,
  subtitle,
  onBack,
  onClose,
  simple = false,
  trailing,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  onClose?: () => void;
  simple?: boolean;
  trailing?: ReactNode;
}) {
  const t = useTranslations("foodKit");
  return (
    <header
      className={styles.pageHeader}
      data-simple={simple}
      data-navigation={Boolean(onBack ?? onClose)}
    >
      {(onBack ?? onClose) && (
        <button
          className={styles.headerNavigation}
          type="button"
          onClick={onClose ?? onBack}
          aria-label={t(onClose ? "close" : "back")}
        >
          <span aria-hidden="true">{onClose ? "×" : "←"}</span>
        </button>
      )}
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className={styles.headerTrailing}>{trailing}</div>
    </header>
  );
}

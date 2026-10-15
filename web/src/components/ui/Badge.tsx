"use client";
import { useTranslations } from "next-intl";
import styles from "./food-ui.module.css";

export function Badge({ verified }: { verified: boolean }) {
  const t = useTranslations("foodKit");
  return (
    <span
      className={`${styles.theme} ${styles.badge}`}
      data-variant={verified ? "checked" : "unverified"}
    >
      {t(verified ? "checked" : "unchecked")}
    </span>
  );
}

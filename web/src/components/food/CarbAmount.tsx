"use client";
import { useLocale, useTranslations } from "next-intl";
import styles from "./food.module.css";

export function CarbAmount({ amount, per100g = false }: { amount: number; per100g?: boolean }) {
  const t = useTranslations("foodKit");
  const locale = useLocale();
  return (
    <span className={styles.amount}>
      {t(per100g ? "per100g" : "carbs", {
        amount: new Intl.NumberFormat(locale, { maximumFractionDigits: per100g ? 1 : 0 }).format(
          amount,
        ),
      })}
    </span>
  );
}

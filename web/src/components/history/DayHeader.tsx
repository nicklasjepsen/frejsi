"use client";
import { useTranslations } from "next-intl";
import type { AppLocale } from "@/lib/i18n/routing";
import { dayHeading, shiftDate } from "./dates";
import styles from "./history.module.css";

export function DayHeader({
  date,
  today,
  carbs,
  count,
  locale,
  onNavigate,
}: {
  date: string;
  today: string;
  carbs: number;
  count: number;
  locale: AppLocale;
  onNavigate: (date: string) => void;
}) {
  const t = useTranslations("history");
  const prefix = date === today ? t("today") : date === shiftDate(today, -1) ? t("yesterday") : "";
  return (
    <header className={styles.dayHeader}>
      <button
        type="button"
        aria-label={t("previousDay")}
        onClick={() => {
          onNavigate(shiftDate(date, -1));
        }}
      >
        ‹
      </button>
      <div>
        <h2>{dayHeading(date, locale)}</h2>
        <p>
          {prefix && `${prefix} · `}
          {t("daySummary", { carbs, count })}
        </p>
      </div>
      <button
        type="button"
        aria-label={t("nextDay")}
        disabled={date >= today}
        onClick={() => {
          onNavigate(shiftDate(date, 1));
        }}
      >
        ›
      </button>
    </header>
  );
}

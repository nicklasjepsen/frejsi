"use client";
import { useTranslations } from "next-intl";
import type { AppLocale } from "@/lib/i18n/routing";
import { dayHeading, shiftDate } from "./dates";
import { PeriodHeader } from "./PeriodHeader";

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
  const summary = t("daySummary", { carbs, count });
  return (
    <PeriodHeader
      heading={dayHeading(date, locale)}
      line={prefix ? `${prefix} · ${summary}` : summary}
      previous={{
        label: t("previousDay"),
        onClick: () => {
          onNavigate(shiftDate(date, -1));
        },
      }}
      next={{
        label: t("nextDay"),
        disabled: date >= today,
        onClick: () => {
          onNavigate(shiftDate(date, 1));
        },
      }}
    />
  );
}

"use client";

import type { DayMealView } from "@frejsi/shared/schemas/meal";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useRef, useState } from "react";

import { formatClock } from "@/lib/i18n/time";

import styles from "./day.module.css";

/**
 * "Dagens måltider" on Nu-Desktop: Tid, Måltid, Kulhydrat, Logget af, oldest first as drawn, with
 * the day's total in the header. The arrow keys move between rows and Enter opens the focused one
 * (`hrefFor`; until v0.3.0's meal detail that is the log screen's `?meal=`). The "Top" column waits
 * for v0.3.0, which has the curve to compute it from.
 */
export function MealsTable({
  meals,
  totalCarbs,
  timeZone,
  hrefFor,
  onOpen,
}: {
  meals: readonly DayMealView[];
  totalCarbs: number;
  timeZone: string;
  hrefFor: (meal: DayMealView) => string;
  onOpen: (href: string) => void;
}) {
  const t = useTranslations("eat.now");
  const locale = useLocale();
  const rows = [...meals].sort((a, b) => a.ts.localeCompare(b.ts));
  const [active, setActive] = useState<string | null>(null);
  const refs = useRef(new Map<string, HTMLTableRowElement>());
  const activeId = rows.some((meal) => meal.id === active) ? active : rows[0]?.id;
  const total = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(totalCarbs);

  return (
    <section className={styles.tableCard} data-testid="meals-table">
      <header className={styles.tableHead}>
        <h2 className={styles.tableTitle}>{t("mealsTitle")}</h2>
        {rows.length > 0 && <span className={styles.meta}>{t("mealsTotal", { total })}</span>}
      </header>
      {rows.length === 0 ? (
        <p className={styles.empty}>{t("noMeals")}</p>
      ) : (
        <>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{t("colTime")}</th>
                <th scope="col">{t("colMeal")}</th>
                <th scope="col">{t("colCarbs")}</th>
                <th scope="col">{t("colBy")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((meal, index) => (
                <tr
                  key={meal.id}
                  ref={(el) => {
                    if (el) refs.current.set(meal.id, el);
                    else refs.current.delete(meal.id);
                  }}
                  tabIndex={meal.id === activeId ? 0 : -1}
                  aria-selected={meal.id === active}
                  onFocus={() => {
                    setActive(meal.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                      event.preventDefault();
                      const step = event.key === "ArrowDown" ? 1 : -1;
                      const next = rows[Math.max(0, Math.min(rows.length - 1, index + step))];
                      if (next) refs.current.get(next.id)?.focus();
                    } else if (event.key === "Enter") {
                      event.preventDefault();
                      onOpen(hrefFor(meal));
                    }
                  }}
                >
                  <td className={styles.cellTime}>
                    <time dateTime={meal.ts}>{formatClock(new Date(meal.ts), timeZone)}</time>
                  </td>
                  <td>
                    <Link href={hrefFor(meal)} tabIndex={-1} className={styles.cellLink}>
                      {meal.title}
                    </Link>
                  </td>
                  <td className={styles.cellNumber}>
                    {t("carbsCell", { carbs: meal.totalCarbs })}
                  </td>
                  <td>{meal.byUser.name}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className={styles.hint}>{t("tableHint")}</p>
        </>
      )}
    </section>
  );
}

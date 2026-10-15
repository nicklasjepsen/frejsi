"use client";

import type { GlucoseUnit } from "@frejsi/shared/schemas/glucose";
import type { DayHistoryMeal } from "@frejsi/shared/schemas/history";
import { PeakValue, formatDuration } from "@/components/stats";

import type { DayMealView } from "@frejsi/shared/schemas/meal";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useRef, useState } from "react";

import { formatClock } from "@/lib/i18n/time";

import styles from "@/components/day/day.module.css";
import nowStyles from "./now.module.css";

/** Today's keyboard-navigable meals, with the history read's timestamped peaks. */
export function NowMealsTable({
  meals,
  totalCarbs,
  timeZone,
  hrefFor,
  onOpen,
  historyMeals,
  unit,
}: {
  meals: readonly DayMealView[];
  historyMeals: readonly DayHistoryMeal[];
  unit: GlucoseUnit;
  totalCarbs: number;
  timeZone: string;
  hrefFor: (meal: DayMealView) => string;
  onOpen: (href: string) => void;
}) {
  const t = useTranslations("eat.now");
  const locale = useLocale();
  const stats = useTranslations("stats");
  const peaks = new Map(historyMeals.map((meal) => [meal.id, meal.stats.peak]));
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
          <div className={nowStyles.tableScroll}>
            <table className={`${styles.table} ${nowStyles.mealsTable}`}>
              <thead>
                <tr>
                  <th scope="col">{t("colTime")}</th>
                  <th scope="col">{t("colMeal")}</th>
                  <th scope="col">{t("colCarbs")}</th>
                  <th scope="col">{t("colBy")}</th>
                  <th scope="col">{stats("peak")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((meal, index) => {
                  const peak = peaks.get(meal.id);
                  return (
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
                      <td className={nowStyles.peakCell}>
                        {peak ? (
                          <>
                            <PeakValue
                              peak={{ ...peak, mealTs: meal.ts }}
                              unit={unit}
                              timeZone={timeZone}
                              layout="value"
                            />{" "}
                            {stats("after", {
                              duration: formatDuration(stats, peak.minutesAfterMeal, "long"),
                            })}
                          </>
                        ) : (
                          stats("missing")
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className={styles.hint}>{t("tableHint")}</p>
        </>
      )}
    </section>
  );
}

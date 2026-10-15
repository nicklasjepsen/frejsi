"use client";
import type { DayHistoryView } from "@frejsi/shared/schemas/history";
import type { GlucoseUnit, Reading } from "@frejsi/shared/schemas/glucose";
import { dayStats } from "@frejsi/shared/stats";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, type KeyboardEvent } from "react";
import { MealCard } from "@/components/day/MealCard";
import { ChartCaption } from "@/components/glucose/ChartCaption";
import { GlucoseChart } from "@/components/glucose/GlucoseChart";
import { formatBound } from "@/components/glucose/format";
import { PeakValue } from "@/components/stats/PeakValue";
import { formatDuration } from "@/components/stats/format";
import { localeHref, type AppLocale } from "@/lib/i18n/routing";
import { DayHeader } from "./DayHeader";
import styles from "./history.module.css";

export function DaySection({
  day,
  today,
  locale,
  unit,
  desktop,
  liveReadings,
  onNavigate,
}: {
  day: DayHistoryView;
  today: string;
  locale: AppLocale;
  unit: GlucoseUnit;
  desktop: boolean;
  liveReadings: readonly Reading[];
  onNavigate: (date: string) => void;
}) {
  const t = useTranslations("history");
  const stats = useTranslations("stats");
  const router = useRouter();
  const links = useRef<(HTMLAnchorElement | null)[]>([]);
  const isToday = day.date === today;
  const now = new Date();
  const readings = [
    ...new Map(
      [...day.readings, ...(isToday ? liveReadings : [])]
        .filter((r) => r.ts >= day.from && r.ts <= day.to && new Date(r.ts) <= now)
        .map((r) => [r.ts, r]),
    ).values(),
  ].sort((a, b) => a.ts.localeCompare(b.ts));
  const range =
    isToday && liveReadings.length > 0
      ? dayStats(readings, day.meals, day.target, { from: day.from, to: day.to }, now).inRange
      : day.inRange;
  const low = formatBound(day.target.low, unit, locale);
  const high = formatBound(day.target.high, unit, locale);
  const mealHref = (id: string) => localeHref(locale, `/meal/${encodeURIComponent(id)}`);
  const move = (event: KeyboardEvent, index: number) => {
    const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (step) {
      event.preventDefault();
      links.current[(index + step + day.meals.length) % day.meals.length]?.focus();
    }
  };
  return (
    <>
      <DayHeader
        date={day.date}
        today={today}
        carbs={day.totalCarbs}
        count={day.mealCount}
        locale={locale}
        onNavigate={onNavigate}
      />
      <div className={styles.dayBody}>
        <div className={styles.curveCard}>
          <GlucoseChart
            variant="day"
            size={desktop ? "desktop" : "phone"}
            labelKind="history"
            readings={readings}
            from={new Date(day.from)}
            to={isToday ? now : new Date(day.to)}
            targetLow={day.target.low}
            targetHigh={day.target.high}
            unit={unit}
            timeZone={day.timezone}
            meals={day.meals.map((meal) => ({
              mealId: meal.id,
              ts: meal.ts,
              ...(meal.bolusTs ? { bolusTs: meal.bolusTs } : {}),
            }))}
            onMealTap={(id) => {
              router.push(mealHref(id));
            }}
          />
          {readings.length === 0 && <p className={styles.muted}>{t("noReadings")}</p>}
          <div className={styles.range}>
            <span>
              {t("inRange", {
                low,
                high,
                duration: formatDuration(stats, range.minutes, "long"),
                covered: formatDuration(stats, range.coveredMinutes, "long"),
              })}
            </span>
            <span>{t("target", { low, high })}</span>
          </div>
          {isToday && (
            <ChartCaption readings={readings} from={new Date(day.from)} to={new Date(day.to)} />
          )}
        </div>
        {day.meals.length === 0 ? (
          <p className={styles.muted}>{t(isToday ? "noMealsToday" : "noMeals")}</p>
        ) : (
          <ul className={styles.timeline} aria-label={t("meals")}>
            {day.meals.map((meal, index) => (
              <li key={meal.id}>
                <Link
                  href={mealHref(meal.id)}
                  ref={(el) => {
                    links.current[index] = el;
                  }}
                  onKeyDown={(event) => {
                    move(event, index);
                  }}
                >
                  <MealCard
                    meal={meal}
                    timeZone={day.timezone}
                    variant="row"
                    detail={
                      <>
                        {t("carbs", { carbs: meal.totalCarbs })}
                        {meal.stats.peak && (
                          <>
                            {" "}
                            · {t("peak")}{" "}
                            <PeakValue
                              peak={{ ...meal.stats.peak, mealTs: meal.ts }}
                              unit={unit}
                              timeZone={day.timezone}
                              layout="value"
                            />{" "}
                            {stats("after", {
                              duration: formatDuration(
                                stats,
                                meal.stats.peak.minutesAfterMeal,
                                "short",
                              ),
                            })}
                          </>
                        )}{" "}
                        · {meal.byUser.name}
                      </>
                    }
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

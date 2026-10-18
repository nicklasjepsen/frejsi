"use client";
import type { DayHistoryView } from "@frejsi/shared/schemas/history";
import type { GlucoseUnit, Reading } from "@frejsi/shared/schemas/glucose";
import type { Role } from "@frejsi/shared/schemas/index";
import { dayStats } from "@frejsi/shared/stats";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { MealCard } from "@/components/day/MealCard";
import { ChartCaption } from "@/components/glucose/ChartCaption";
import { GlucoseChart } from "@/components/glucose/GlucoseChart";
import { formatBound } from "@/components/glucose/format";
import { readingsAround } from "@/components/glucose/symptom-readings";
import { useAgeText } from "@/components/glucose/useAgeText";
import { useNow } from "@/components/glucose/useNow";
import { usePumpHistory } from "@/components/pump/usePumpHistory";
import { PeakValue } from "@/components/stats/PeakValue";
import { formatDuration } from "@/components/stats/format";
import { useKindLabel } from "@/components/symptoms/kinds";
import type { FeedEventType } from "@/lib/live/live-feed";
import { localeHref, type AppLocale } from "@/lib/i18n/routing";
import { DayHeader } from "./DayHeader";
import { SymptomDetailCard } from "./SymptomDetailCard";
import { SymptomRow } from "./SymptomRow";
import { SymptomsFailed } from "./SymptomsFailed";
import { beforeInstant, useSymptomRange } from "./useSymptomRange";
import styles from "./history.module.css";

type Subscribe = (type: FeedEventType, handler: () => void) => () => void;

export function DaySection({
  spaceId,
  day,
  today,
  locale,
  unit,
  desktop,
  liveReadings,
  onNavigate,
  role = "owner",
  simpleMode = false,
  subscribe,
  symptomsOnly = false,
  headerExtra,
}: {
  spaceId: string;
  day: DayHistoryView;
  today: string;
  locale: AppLocale;
  unit: GlucoseUnit;
  desktop: boolean;
  liveReadings: readonly Reading[];
  onNavigate: (date: string) => void;
  /**
   * Passed to every row for its "Ret". The history day is mounted for owners and carers only
   * (a viewer gets `ViewerDays`), so the default names the role the screen is for.
   */
  role?: Role;
  /**
   * The history page sends a simpleMode session to Nu; with it set the pump record is not read
   * (v0.7.0: simpleMode shows nothing new), as for a viewer.
   */
  simpleMode?: boolean;
  /** The screen's feed: the day's symptoms are read again on every `symptom.*` event. */
  subscribe?: Subscribe | undefined;
  /** The "Symptomer" filter (plan §5): the list shows the symptom rows only. */
  symptomsOnly?: boolean;
  /** The phone's filter chip, drawn in the period header. */
  headerExtra?: ReactNode;
}) {
  const t = useTranslations("history");
  const stats = useTranslations("stats");
  const glucose = useTranslations("glucose");
  const ageText = useAgeText();
  const router = useRouter();
  const rows = useRef<(HTMLLIElement | null)[]>([]);
  const isToday = day.date === today;
  // The 30-second clock the ages are read at, so an open detail does not freeze on "lige nu".
  const now = useNow();
  const symptomRange = useSymptomRange(spaceId, day.from, beforeInstant(day.to), subscribe);
  const symptoms = symptomRange.status === "ready" ? symptomRange.symptoms : [];
  // The day's pump record (v0.7.0 plan §9), read again on `pump.*`; never for a viewer or in
  // simpleMode, and the route refuses both anyway. Half-open like the symptoms: a bolus at the
  // next midnight belongs to the next day only.
  const pumpHistory = usePumpHistory(spaceId, day.from, beforeInstant(day.to), {
    subscribe,
    role,
    simpleMode,
  });
  const pump =
    pumpHistory.status === "ready"
      ? { boluses: pumpHistory.boluses, reach: pumpHistory.reach }
      : undefined;
  const labelOf = useKindLabel(locale, symptomRange.kinds);
  const [activeSymptomId, setActiveSymptomId] = useState<string | null>(null);
  const activeSymptom = symptoms.find((symptom) => symptom.id === activeSymptomId) ?? null;
  const readings = [
    ...new Map(
      [...day.readings, ...(isToday ? liveReadings : [])]
        .filter((r) => r.ts >= day.from && r.ts <= day.to && new Date(r.ts) <= now)
        .map((r) => [r.ts, r]),
    ).values(),
  ].sort((a, b) => a.ts.localeCompare(b.ts));
  const liveStats =
    isToday && liveReadings.length > 0
      ? dayStats(readings, day.meals, day.target, { from: day.from, to: day.to }, now)
      : null;
  const range = liveStats?.inRange ?? day.inRange;
  const meals = day.meals.map((meal) => ({
    ...meal,
    stats: liveStats?.meals.find((item) => item.mealId === meal.id)?.stats ?? meal.stats,
  }));
  const low = formatBound(day.target.low, unit, locale);
  const high = formatBound(day.target.high, unit, locale);
  const mealHref = (id: string) => localeHref(locale, `/meal/${encodeURIComponent(id)}`);
  // The day's list: the meal rows and the symptom rows by time, newest first; with the filter
  // on, the symptom rows alone.
  type Entry = { ts: string } & (
    | { kind: "meal"; meal: (typeof meals)[number] }
    | { kind: "symptom"; symptom: (typeof symptoms)[number] }
  );
  const entries: Entry[] = [
    ...(symptomsOnly ? [] : meals.map((meal) => ({ kind: "meal" as const, ts: meal.ts, meal }))),
    ...symptoms.map((symptom) => ({ kind: "symptom" as const, ts: symptom.ts, symptom })),
  ].sort((a, b) => b.ts.localeCompare(a.ts));
  const move = (event: KeyboardEvent, index: number) => {
    const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (step) {
      event.preventDefault();
      rows.current[(index + step + entries.length) % entries.length]
        ?.querySelector<HTMLElement>("a, button")
        ?.focus();
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
        {...(headerExtra ? { filter: headerExtra } : {})}
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
              ...(meal.symbol !== undefined ? { symbol: meal.symbol } : {}),
              ...(meal.pumpBolusId !== undefined ? { pumpBolusId: meal.pumpBolusId } : {}),
            }))}
            {...(pump ? { pump } : {})}
            onMealTap={(id) => {
              router.push(mealHref(id));
            }}
            symptoms={symptoms.map((symptom) => ({
              id: symptom.id,
              ts: symptom.ts,
              kind: symptom.kind,
              label: labelOf(symptom.kind),
            }))}
            onSymptomTap={setActiveSymptomId}
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
          {activeSymptom && (
            <SymptomDetailCard
              locale={locale}
              timeZone={day.timezone}
              symptom={activeSymptom}
              spaceKinds={symptomRange.kinds}
              readings={readingsAround(
                activeSymptom.ts,
                readings,
                unit,
                locale,
                glucose(`unit.${unit}`),
                (ts) => ageText(ts, now),
              )}
              onClose={() => {
                setActiveSymptomId(null);
              }}
            />
          )}
        </div>
        {symptomRange.status === "failed" && <SymptomsFailed onRetry={symptomRange.refresh} />}
        {entries.length === 0 ? (
          symptomsOnly && symptomRange.status !== "ready" ? null : (
            <p className={styles.muted}>
              {t(symptomsOnly ? "noSymptoms" : isToday ? "noMealsToday" : "noMeals")}
            </p>
          )
        ) : (
          <ul className={styles.timeline} aria-label={t("meals")}>
            {entries.map((entry, index) => (
              <li
                key={entry.kind === "meal" ? entry.meal.id : entry.symptom.id}
                ref={(el) => {
                  rows.current[index] = el;
                }}
                onKeyDown={(event) => {
                  move(event, index);
                }}
              >
                {entry.kind === "symptom" ? (
                  <SymptomRow
                    symptom={entry.symptom}
                    locale={locale}
                    timeZone={day.timezone}
                    spaceKinds={symptomRange.kinds}
                    onOpen={setActiveSymptomId}
                  />
                ) : (
                  <MealCard
                    meal={entry.meal}
                    timeZone={day.timezone}
                    variant="row"
                    locale={locale}
                    role={role}
                    detail={
                      <>
                        {t("carbs", { carbs: entry.meal.totalCarbs })}
                        {entry.meal.stats.peak && (
                          <>
                            {" "}
                            · {t("peak")}{" "}
                            <PeakValue
                              peak={{ ...entry.meal.stats.peak, mealTs: entry.meal.ts }}
                              unit={unit}
                              timeZone={day.timezone}
                              layout="value"
                            />{" "}
                            {stats("after", {
                              duration: formatDuration(
                                stats,
                                entry.meal.stats.peak.minutesAfterMeal,
                                "short",
                              ),
                            })}
                          </>
                        )}{" "}
                        · {entry.meal.byUser.name}
                      </>
                    }
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

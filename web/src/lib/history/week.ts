import {
  HttpError,
  WeekHistoryView,
  dayRange,
  dayStats,
  downsample,
  mealStats,
  mealsInRange,
  mealTitle,
  weekRange,
  weekStats,
  COVERAGE_CAP_MINUTES,
  STATS_WINDOW_MINUTES,
  MINUTE_MS,
  type Locale,
  type WeekNumbers,
} from "@frejsi/shared";
import { localDate } from "@/app/api/spaces/[spaceId]/day/load-day";
import { dateAfter, requireSpace, untilNow } from "./views";
import type { HistoryDeps } from "./types";

/**
 * An untouched pump meal has no lead (its time is the bolus's), so the week's lead figure counts
 * only the meals a person logged or adopted: "registered 3 of 3", not "3 of 5" (plan task 5). The
 * meal count and the carbs still include pump meals.
 */
function leadOfLoggedMeals(numbers: WeekNumbers, logged: number): WeekNumbers {
  return { ...numbers, bolusLead: { ...numbers.bolusLead, of: logged } };
}
export async function loadHistoryWeek(
  spaceId: string,
  start: string | null,
  locale: Locale,
  deps: HistoryDeps,
): Promise<WeekHistoryView> {
  const now = deps.now();
  const space = await requireSpace(spaceId, deps);
  const range = weekRange(start ?? localDate(now, space.timezone), space.timezone);
  if (start !== null && start !== range.weekStart) throw new HttpError(400, "validation");
  const [readings, previousWeekReadings, rows] = await Promise.all([
    deps.repo.readingsBetween(
      spaceId,
      new Date(+range.from - COVERAGE_CAP_MINUTES * MINUTE_MS),
      untilNow(
        new Date(+range.to + (STATS_WINDOW_MINUTES + COVERAGE_CAP_MINUTES) * MINUTE_MS),
        now,
      ),
    ),
    deps.repo.readingsBetween(
      spaceId,
      new Date(
        +dayRange(dateAfter(range.weekStart, -7), space.timezone)[0] -
          COVERAGE_CAP_MINUTES * MINUTE_MS,
      ),
      untilNow(new Date(+range.from + COVERAGE_CAP_MINUTES * MINUTE_MS), now),
    ),
    deps.repo.mealsBetween(spaceId, range.from, range.to),
  ]);
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = dateAfter(range.weekStart, i);
    const [from, to] = dayRange(date, space.timezone);
    const stats = dayStats(readings, rows, space.target, { from, to }, now);
    return {
      date,
      mealCount: stats.mealCount,
      totalCarbs: stats.totalCarbs,
      ...(stats.inRange.coveredMinutes
        ? {
            inRangePercent: Math.round(
              (stats.inRange.minutes / stats.inRange.coveredMinutes) * 100,
            ),
          }
        : {}),
      curve: downsample(
        readings.filter((r) => Date.parse(r.ts) >= +from && Date.parse(r.ts) < +to),
        30,
        from,
      ),
      mealTimes: mealsInRange(rows, { from, to }).map((m) => m.ts),
      meals: mealsInRange(rows, { from, to }).map((m) => ({
        ts: m.ts,
        symbol: rows.find((r) => r.id === m.id)?.symbol ?? "unknown",
      })),
    };
  });
  return WeekHistoryView.parse({
    weekStart: range.weekStart,
    weekEnd: range.weekEnd,
    isoWeek: range.isoWeek,
    isoYear: range.isoYear,
    timezone: space.timezone,
    target: space.target,
    days,
    numbers: leadOfLoggedMeals(
      weekStats({
        readings,
        previousWeekReadings,
        meals: rows,
        target: space.target,
        weekRange: range,
        timezone: space.timezone,
        now,
      }),
      mealsInRange(
        rows.filter((row) => row.source !== "pump"),
        range,
      ).length,
    ),
    meals: mealsInRange(rows, range).map((meal) => {
      const row = rows.find((r) => r.id === meal.id);
      if (!row) throw new Error("History meal missing");
      const stats = mealStats(readings, meal, space.target, now);
      return {
        mealId: meal.id,
        ts: meal.ts,
        title: mealTitle(row.items, undefined, locale),
        totalCarbs: meal.totalCarbs,
        ...(stats.bolusLeadMinutes === undefined
          ? {}
          : { bolusLeadMinutes: stats.bolusLeadMinutes }),
        stats,
      };
    }),
    now: now.toISOString(),
  });
}

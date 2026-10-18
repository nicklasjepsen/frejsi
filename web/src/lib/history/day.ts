import {
  DayHistoryView,
  dayRange,
  dayStats,
  COVERAGE_CAP_MINUTES,
  STATS_WINDOW_MINUTES,
  MINUTE_MS,
  type Locale,
} from "@frejsi/shared";
import { localDate } from "@/app/api/spaces/[spaceId]/day/load-day";
import { mealView, pumpLink, requireSpace, untilNow } from "./views";
import type { HistoryDeps } from "./types";
export async function loadHistoryDay(
  spaceId: string,
  date: string | null,
  includeReadings: boolean,
  locale: Locale,
  deps: HistoryDeps,
): Promise<DayHistoryView> {
  const now = deps.now();
  const space = await requireSpace(spaceId, deps);
  const day = date ?? localDate(now, space.timezone);
  const [from, to] = dayRange(day, space.timezone);
  const [readings, rows, hasOlder] = await Promise.all([
    deps.repo.readingsBetween(
      spaceId,
      new Date(+from - COVERAGE_CAP_MINUTES * MINUTE_MS),
      untilNow(new Date(+to + (STATS_WINDOW_MINUTES + COVERAGE_CAP_MINUTES) * MINUTE_MS), now),
    ),
    deps.repo.mealsBetween(spaceId, from, to),
    deps.repo.hasAnythingBefore(spaceId, from),
  ]);
  const stats = dayStats(readings, rows, space.target, { from, to }, now);
  const meals = await Promise.all(
    stats.meals.map(async ({ mealId, stats }) => {
      const row = rows.find((m) => m.id === mealId);
      if (!row) throw new Error("History meal missing");
      return {
        ...(await mealView(row, space.timezone, locale, deps)),
        ...(row.bolusTs ? { bolusTs: row.bolusTs } : {}),
        ...pumpLink(row),
        stats,
      };
    }),
  );
  return DayHistoryView.parse({
    date: day,
    timezone: space.timezone,
    from: from.toISOString(),
    to: to.toISOString(),
    target: space.target,
    readings: includeReadings
      ? readings.filter((r) => Date.parse(r.ts) >= +from && Date.parse(r.ts) <= Math.min(+to, +now))
      : [],
    inRange: stats.inRange,
    totalCarbs: stats.totalCarbs,
    mealCount: stats.mealCount,
    meals,
    hasOlder,
    now: now.toISOString(),
  });
}

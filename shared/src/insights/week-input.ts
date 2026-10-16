import { prisma } from "../db/client";
import { dayRange } from "../meals/day-range";
import { mealTitle } from "../meals/title";
import { AiProviderId, type WeekInsightInput } from "../schemas/ai";
import type { Reading } from "../schemas/glucose";
import type { Target } from "../schemas/history";
import { dayStats, mealsInRange } from "../stats/day";
import { mealStats } from "../stats/meal";
import { weekRange, weekStats } from "../stats/week";
import { buildWeekInput, localParts } from "../ai/insight/input";
export interface WeekSpace {
  id: string;
  timezone: string;
  locale: "da" | "en";
  glucoseUnit: "mmol" | "mgdl";
  target: Target;
  aiProvider: AiProviderId;
}
export interface WeekMeal {
  id: string;
  ts: string;
  totalCarbs: number;
  title: string;
  bolusTs?: string | undefined;
}
export interface WeekSource {
  spaces(): Promise<WeekSpace[]>;
  readingsBetween(spaceId: string, from: Date, to: Date): Promise<Reading[]>;
  mealsBetween(
    spaceId: string,
    from: Date,
    to: Date,
    locale: WeekSpace["locale"],
  ): Promise<WeekMeal[]>;
}
export const dateAfter = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
export function weeklyWindow(now: Date, timezone: string): string | null {
  const { localDate, localTime } = localParts(now, timezone);
  const day = new Date(`${localDate}T00:00:00Z`).getUTCDay();
  if (day === 0 && localTime >= "18:00") return weekRange(localDate, timezone).weekStart;
  if (day === 1 && localTime < "06:00") return dateAfter(localDate, -7);
  return null;
}
export function readyAt(start: string, timezone: string): Date {
  // Sunday 18:00, using the day's local UTC offset (including DST transitions).
  const sunday = dateAfter(start, 6);
  return new Date(+dayRange(dateAfter(sunday, 1), timezone)[0] - 6 * 3600000);
}
export async function buildWeekInsightInput(
  space: WeekSpace,
  start: string,
  source: WeekSource,
  now: Date,
): Promise<WeekInsightInput> {
  const range = weekRange(start, space.timezone);
  const previousFrom = dayRange(dateAfter(start, -7), space.timezone)[0];
  const [readings, previousWeekReadings, rows] = await Promise.all([
    source.readingsBetween(
      space.id,
      new Date(+range.from - 600000),
      new Date(Math.min(+now, +range.to + 4 * 3600000)),
    ),
    source.readingsBetween(
      space.id,
      new Date(+previousFrom - 600000),
      new Date(Math.min(+now, +range.from + 600000)),
    ),
    source.mealsBetween(space.id, range.from, range.to, space.locale),
  ]);
  const numbers = weekStats({
    readings,
    previousWeekReadings,
    meals: rows,
    target: space.target,
    weekRange: range,
    timezone: space.timezone,
    now,
  });
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = dateAfter(start, i);
    const [from, to] = dayRange(date, space.timezone);
    const stats = dayStats(readings, rows, space.target, { from, to }, now);
    return {
      localDate: date,
      mealCount: stats.mealCount,
      totalCarbs: stats.totalCarbs,
      inRangePercent: stats.inRange.coveredMinutes
        ? Math.round((stats.inRange.minutes / stats.inRange.coveredMinutes) * 100)
        : undefined,
    };
  });
  const meals = mealsInRange(rows, range, now).map((m) => ({
    mealId: m.id,
    ts: new Date(m.ts).toISOString(),
    title: rows.find((r) => r.id === m.id)?.title ?? "",
    totalCarbs: m.totalCarbs,
    stats: mealStats(readings, m, space.target, now),
  }));
  return buildWeekInput({
    locale: space.locale,
    glucoseUnit: space.glucoseUnit,
    timezone: space.timezone,
    weekStart: start,
    isoWeek: range.isoWeek,
    numbers,
    days,
    meals,
  });
}
export class PrismaWeekSource implements WeekSource {
  async spaces(): Promise<WeekSpace[]> {
    const rows = await prisma.space.findMany({
      where: { aiEnabled: true },
      select: {
        id: true,
        timezone: true,
        glucoseUnit: true,
        targetLow: true,
        targetHigh: true,
        aiProvider: true,
        subjectUser: { select: { locale: true } },
      },
    });
    return rows.flatMap((r) => {
      const provider = AiProviderId.safeParse(r.aiProvider);
      return provider.success
        ? [
            {
              id: r.id,
              timezone: r.timezone,
              glucoseUnit: r.glucoseUnit as WeekSpace["glucoseUnit"],
              locale: (r.subjectUser?.locale ?? "da") as WeekSpace["locale"],
              target: { low: Number(r.targetLow), high: Number(r.targetHigh) },
              aiProvider: provider.data,
            },
          ]
        : [];
    });
  }
  async readingsBetween(spaceId: string, from: Date, to: Date): Promise<Reading[]> {
    const rows = await prisma.reading.findMany({
      where: { spaceId, ts: { gte: from, lte: to } },
      select: { ts: true, mmol: true, trend: true },
      orderBy: { ts: "asc" },
    });
    return rows.map((r) => ({
      ts: r.ts.toISOString(),
      mmol: Number(r.mmol),
      trend: r.trend as Reading["trend"],
    }));
  }
  async mealsBetween(spaceId: string, from: Date, to: Date, locale: WeekSpace["locale"]) {
    const rows = await prisma.meal.findMany({
      where: { spaceId, ts: { gte: from, lt: to } },
      orderBy: [{ ts: "desc" }, { id: "desc" }],
      include: { items: { orderBy: { position: "asc" } } },
    });
    return rows.map((r) => ({
      id: r.id,
      ts: r.ts.toISOString(),
      totalCarbs: r.totalCarbs,
      bolusTs: r.bolusTs?.toISOString(),
      title: mealTitle(r.items, undefined, locale),
    }));
  }
}

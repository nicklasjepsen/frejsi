import {
  InsightInput,
  InsightStats,
  WeekInsightInput,
  type InsightNumbers,
} from "../../schemas/ai";
import type { MealStats, MealStatsRow, WeekNumbers } from "../../schemas/history";

export function insightStats(stats: MealStats): InsightStats {
  return InsightStats.parse({
    ...(stats.peak
      ? { peak: { mmol: stats.peak.mmol, minutesAfterMeal: stats.peak.minutesAfterMeal } }
      : {}),
    inRange: { ...stats.inRange },
    ...(stats.bolusLeadMinutes === undefined ? {} : { leadMinutes: stats.bolusLeadMinutes }),
    readingCount: stats.readingCount,
  });
}
export function buildMealInput(input: {
  locale: InsightInput["locale"];
  glucoseUnit: InsightInput["glucoseUnit"];
  meal: InsightInput["meal"];
  stats: MealStats;
  previous: { localDate: string; totalCarbs: number; stats: MealStats }[];
}): InsightInput {
  const lead = input.stats.bolusLeadMinutes;
  return InsightInput.parse({
    locale: input.locale,
    glucoseUnit: input.glucoseUnit,
    meal: {
      title: input.meal.title.slice(0, 200),
      totalCarbs: input.meal.totalCarbs,
      slot: input.meal.slot,
      localTime: input.meal.localTime,
    },
    stats: insightStats(input.stats),
    previous: input.previous.map((p) => ({
      localDate: p.localDate,
      totalCarbs: p.totalCarbs,
      stats: insightStats(p.stats),
    })),
    leadLabel: lead === undefined ? "none" : lead >= 0 ? "before" : "after",
  });
}
export function localParts(ts: string | Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ts));
  const p = (key: string) => parts.find((part) => part.type === key)?.value ?? "";
  return {
    localDate: `${p("year")}-${p("month")}-${p("day")}`,
    localTime: `${p("hour")}:${p("minute")}`,
  };
}
export function buildWeekInput(input: {
  locale: WeekInsightInput["locale"];
  glucoseUnit: WeekInsightInput["glucoseUnit"];
  isoWeek: number;
  weekStart: string;
  timezone: string;
  numbers: WeekNumbers;
  days: WeekInsightInput["days"];
  meals: MealStatsRow[];
}): WeekInsightInput {
  const n = input.numbers;
  const numbers: InsightNumbers = {
    inRangePercent: n.inRangePercent,
    previousWeekInRangePercent: n.previousWeekInRangePercent,
    belowPercent: n.belowPercent,
    lowEpisodes: { ...n.lowEpisodes },
    carbsPerDay: n.carbsPerDay,
    mealCount: n.mealCount,
    lead: { ...n.bolusLead },
  };
  return WeekInsightInput.parse({
    locale: input.locale,
    glucoseUnit: input.glucoseUnit,
    isoWeek: input.isoWeek,
    weekStart: input.weekStart,
    numbers,
    days: input.days.map((d) => ({
      localDate: d.localDate,
      mealCount: d.mealCount,
      totalCarbs: d.totalCarbs,
      inRangePercent: d.inRangePercent,
    })),
    meals: input.meals.slice(0, 40).map((m) => ({
      ...localParts(m.ts, input.timezone),
      title: m.title.slice(0, 200),
      totalCarbs: m.totalCarbs,
      peak: insightStats(m.stats).peak,
      inRangePercent: m.stats.inRange.coveredMinutes
        ? Math.round((m.stats.inRange.minutes / m.stats.inRange.coveredMinutes) * 100)
        : undefined,
      leadMinutes: m.stats.bolusLeadMinutes,
    })),
  });
}

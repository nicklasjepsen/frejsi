import {
  InsightInput,
  InsightStats,
  WeekInsightInput,
  type InsightNumbers,
} from "../../schemas/ai";
import type { MealStats, MealStatsRow, WeekNumbers } from "../../schemas/history";
import type { SymptomKind } from "../../schemas/symptom";

/** A logged symptom as the builders take it: the kind and when. Never the note, never a reading. */
export interface LoggedSymptom {
  kind: SymptomKind;
  ts: string;
}
const MINUTE_MS = 60_000;
/** Symptoms from an hour before the meal to four hours after it belong to its narration. */
export const SYMPTOM_WINDOW_MINUTES = { before: 60, after: 240 } as const;

/** The symptoms in the window as kind and minutes after the meal, earliest first. */
export function symptomsAround(
  mealTs: string,
  symptoms: readonly LoggedSymptom[],
): { kind: SymptomKind; minutesAfterMeal: number }[] {
  const meal = Date.parse(mealTs);
  return symptoms
    .map((s) => ({
      kind: s.kind,
      minutesAfterMeal: Math.round((Date.parse(s.ts) - meal) / MINUTE_MS),
    }))
    .filter(
      (s) =>
        s.minutesAfterMeal >= -SYMPTOM_WINDOW_MINUTES.before &&
        s.minutesAfterMeal <= SYMPTOM_WINDOW_MINUTES.after,
    )
    .sort((a, b) => a.minutesAfterMeal - b.minutesAfterMeal)
    .slice(0, 20);
}

/** How often each kind occurs, most frequent first, then by kind. */
export function symptomCounts(
  symptoms: readonly { kind: SymptomKind }[],
): { kind: SymptomKind; count: number }[] {
  const counts = new Map<SymptomKind, number>();
  for (const { kind } of symptoms) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  return [...counts]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind))
    .slice(0, 40);
}

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
  /** The meal's instant; needed only to place `loggedSymptoms`. */
  mealTs?: string;
  loggedSymptoms?: readonly LoggedSymptom[];
}): InsightInput {
  const lead = input.stats.bolusLeadMinutes;
  const symptoms =
    input.mealTs && input.loggedSymptoms && input.loggedSymptoms.length > 0
      ? symptomsAround(input.mealTs, input.loggedSymptoms)
      : [];
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
    ...(symptoms.length > 0 ? { symptoms } : {}),
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
  /** `source: "pump"` marks an untouched pump meal: it never reaches a model (v0.7.0 plan §5). */
  meals: (MealStatsRow & { source?: string | null | undefined })[];
  symptoms?: readonly { kind: SymptomKind }[];
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
    meals: input.meals
      .filter((m) => m.source !== "pump")
      .slice(0, 40)
      .map((m) => ({
        ...localParts(m.ts, input.timezone),
        title: m.title.slice(0, 200),
        totalCarbs: m.totalCarbs,
        peak: insightStats(m.stats).peak,
        inRangePercent: m.stats.inRange.coveredMinutes
          ? Math.round((m.stats.inRange.minutes / m.stats.inRange.coveredMinutes) * 100)
          : undefined,
        leadMinutes: m.stats.bolusLeadMinutes,
      })),
    ...(input.symptoms && input.symptoms.length > 0
      ? { symptomCounts: symptomCounts(input.symptoms) }
      : {}),
  });
}

// The statistics these components show, typed against the v0.3.0 plan §4 contract
// (`shared/src/schemas/history.ts`, built in parallel by #48). The shapes match the plan exactly;
// the integration lanes swap these for the shared types once both have merged.

export interface InRange {
  minutes: number;
  coveredMinutes: number;
  windowMinutes: number;
  complete: boolean;
  belowMinutes: number;
  aboveMinutes: number;
}

export interface MealStats {
  peak?: { mmol: number; ts: string; minutesAfterMeal: number };
  inRange: InRange;
  /** Minutes from the bolus tap to the meal; positive before. A time difference, nothing else. */
  bolusLeadMinutes?: number;
  readingCount: number;
}

export interface MealStatsRow {
  mealId: string;
  ts: string;
  title: string;
  totalCarbs: number;
  bolusLeadMinutes?: number;
  stats: MealStats;
}

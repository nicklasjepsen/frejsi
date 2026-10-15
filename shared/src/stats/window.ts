export const CHART_BEFORE_MINUTES = 60;
export const CHART_AFTER_MINUTES = 240;
export const STATS_WINDOW_MINUTES = 180;
export const COVERAGE_CAP_MINUTES = 15;
export const MINUTE_MS = 60000;
export type Timestamp = string | Date;
export interface TimeRange {
  from: Timestamp;
  to: Timestamp;
}
export const milliseconds = (ts: Timestamp): number => new Date(ts).getTime();
export function mealWindow(mealTs: Timestamp): { from: Date; to: Date } {
  const ts = milliseconds(mealTs);
  return {
    from: new Date(ts - CHART_BEFORE_MINUTES * MINUTE_MS),
    to: new Date(ts + CHART_AFTER_MINUTES * MINUTE_MS),
  };
}
/** Keep the full end boundary so coverage and completeness remain separate. */
export function statsWindow(
  mealTs: Timestamp,
  now: Timestamp,
): { from: Date; to: Date; complete: boolean } {
  const from = new Date(mealTs);
  const to = new Date(from.getTime() + STATS_WINDOW_MINUTES * MINUTE_MS);
  return { from, to, complete: milliseconds(now) >= to.getTime() };
}

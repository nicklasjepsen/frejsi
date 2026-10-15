// The live end of a meal's curve (v0.3.0 plan §8): the readings the curve route returned, plus
// the readings `useLiveFeed` has received since, inside the meal's window and merged by `ts`; the
// tiles are recomputed from them with the same `shared/src/stats/` function the server used.
import type { Reading } from "@frejsi/shared/schemas/glucose";
import type { MealCurveView, MealStats } from "@frejsi/shared/schemas/history";
import { mealStats } from "@frejsi/shared/stats/meal";

export interface LiveCurve {
  readings: Reading[];
  stats: MealStats;
  /** The later of the server's `now` and the client's clock. */
  now: Date;
}

export function liveCurve(
  view: MealCurveView,
  live: readonly Reading[],
  clientNow: Date,
): LiveCurve {
  const from = new Date(view.window.from).getTime();
  const to = new Date(view.window.to).getTime();
  const byTs = new Map<number, Reading>();
  for (const reading of view.readings) byTs.set(new Date(reading.ts).getTime(), reading);
  for (const reading of live) {
    const at = new Date(reading.ts).getTime();
    if (at >= from && at <= to) byTs.set(at, reading);
  }
  const readings = [...byTs.entries()].sort(([a], [b]) => a - b).map(([, reading]) => reading);
  const now = new Date(Math.max(new Date(view.now).getTime(), clientNow.getTime()));
  const stats = mealStats(
    readings,
    { ts: view.meal.ts, bolusTs: view.meal.bolusTs },
    view.target,
    now,
  );
  return { readings, stats, now };
}

/** True when no reading of the window is drawn yet (none at or before `now`). */
export function hasNoReadings(view: MealCurveView, readings: readonly Reading[], now: Date) {
  const from = new Date(view.window.from).getTime();
  return !readings.some((r) => {
    const at = new Date(r.ts).getTime();
    return at >= from && at <= now.getTime();
  });
}

// Test data for meal detail: `MealCurveView`s built from the fictional curve fixtures (the same
// series and the same `shared/src/stats/` the server uses), and a recording fetch fake that serves
// `GET meals/[id]/curve` and `GET meals/[id]` in the shapes of the Zod contracts. Imported only
// from *.test.ts(x).
import { readFileSync } from "node:fs";
import path from "node:path";

import type { Reading } from "@frejsi/shared/schemas/glucose";
import { MealCurveView, type PreviousMealView } from "@frejsi/shared/schemas/history";
import { MealView } from "@frejsi/shared/schemas/meal";
import { mealStats } from "@frejsi/shared/stats/meal";
import { mealWindow } from "@frejsi/shared/stats/window";

interface CurveFixture {
  mealTs: string;
  bolusTs?: string;
  timezone: string;
  target: { low: number; high: number };
  readings: Reading[];
}

const fixtures = path.resolve(import.meta.dirname, "../../../../fixtures/curves");

export function curveFixture(name: string): CurveFixture {
  return JSON.parse(readFileSync(path.join(fixtures, `${name}.json`), "utf8")) as CurveFixture;
}

const MINUTE = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();
export const shift = (ts: string, minutes: number) =>
  iso(new Date(ts).getTime() + minutes * MINUTE);

/** meal-typical.json: 12:00 in Copenhagen on Wednesday 14 October, bolus 12 minutes before. */
export const TYPICAL = curveFixture("meal-typical");
export const MEAL_TS = TYPICAL.mealTs;

export function mealView(fields: Partial<MealView> = {}): MealView {
  return MealView.parse({
    id: "m1",
    ts: MEAL_TS,
    title: "Rye bread with cheese and an apple",
    slot: "lunch",
    totalCarbs: 50,
    byUser: { id: "u-jonas", name: "Jonas" },
    items: [
      { name: "Rye bread", portionLabel: "2 slices", carbs: 36 },
      { name: "Cheese", portionLabel: "1 slice", carbs: 0 },
      { name: "Apple", portionLabel: "1 medium", carbs: 14 },
    ],
    ...(TYPICAL.bolusTs ? { bolusTs: TYPICAL.bolusTs } : {}),
    ...fields,
  });
}

/** An earlier occurrence `days` before, the same curve a little higher. */
export function previousMeal(days: number, lift = 0.2): PreviousMealView {
  const ts = shift(MEAL_TS, -days * 24 * 60);
  const readings = TYPICAL.readings.map((r) => ({
    ...r,
    ts: shift(r.ts, -days * 24 * 60),
    mmol: Math.round((r.mmol + lift * days) * 10) / 10,
  }));
  const bolusTs = shift(ts, -10);
  return {
    mealId: `p${days}`,
    ts,
    title: "Rye bread with cheese and an apple",
    totalCarbs: 48,
    bolusLeadMinutes: 10,
    stats: mealStats(readings, { ts, bolusTs }, TYPICAL.target, ts),
    readings,
  };
}

/** A curve view as the route answers it, at `now`; readings after `now` are left out. */
export function curveView(
  options: {
    meal?: MealView;
    readings?: Reading[];
    previous?: PreviousMealView[];
    now?: string;
    target?: { low: number; high: number };
  } = {},
): MealCurveView {
  const meal = options.meal ?? mealView();
  const now = options.now ?? shift(meal.ts, 6 * 60);
  const window = mealWindow(meal.ts);
  const target = options.target ?? TYPICAL.target;
  const readings = (options.readings ?? TYPICAL.readings).filter(
    (r) =>
      new Date(r.ts) >= window.from &&
      new Date(r.ts) <= window.to &&
      new Date(r.ts).getTime() <= new Date(now).getTime(),
  );
  return MealCurveView.parse({
    meal,
    editItems: meal.items,
    window: { from: window.from.toISOString(), to: window.to.toISOString() },
    target,
    readings,
    stats: mealStats(readings, { ts: meal.ts, bolusTs: meal.bolusTs }, target, now),
    previous: options.previous ?? [],
    neighbours: {},
    now,
  });
}

export interface MealApi {
  fetch: typeof fetch;
  /** "GET /api/spaces/s1/meals/m1/curve" and so on, in order. */
  calls: string[];
  curve: MealCurveView;
  meal: MealView;
  /** Answer every read with this status instead (404, 500). */
  status: number | null;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export function mealApi(curve: MealCurveView = curveView()): MealApi {
  const api: MealApi = {
    calls: [],
    curve,
    meal: curve.meal,
    status: null,
    fetch: async (input: RequestInfo | URL, init: RequestInit = {}) => {
      await Promise.resolve();
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        "http://localhost",
      );
      api.calls.push(`${init.method ?? "GET"} ${url.pathname}${url.search}`);
      if (api.status !== null) {
        return json(api.status, {
          error: { code: api.status === 404 ? "not-found" : "internal", message: "x" },
        });
      }
      if (/^\/api\/spaces\/[^/]+\/meals\/[^/]+\/curve$/.test(url.pathname))
        return json(200, api.curve);
      if (/^\/api\/spaces\/[^/]+\/meals\/[^/]+$/.test(url.pathname)) return json(200, api.meal);
      return json(404, { error: { code: "not-found", message: "x" } });
    },
  };
  return api;
}

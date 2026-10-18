import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, expectTypeOf, it } from "vitest";
import { type z } from "zod";
import * as history from "./history";
import * as publicSchemas from "./index";
import { DayView } from "./meal";
import { EventPayloads } from "./events";
import { findDosingVocabulary, schemaVocabulary } from "../dosing-vocabulary";

const ts = "2026-10-14T10:00:00Z";
const target = { low: 4, high: 10 };
const inRange = {
  minutes: 180,
  coveredMinutes: 180,
  windowMinutes: 180,
  complete: true,
  belowMinutes: 0,
  aboveMinutes: 0,
};
const stats = {
  peak: { mmol: 9.6, ts, minutesAfterMeal: 65 },
  inRange,
  bolusLeadMinutes: 12,
  readingCount: 37,
};
const meal = {
  id: "m1",
  ts,
  title: "Example lunch",
  slot: "lunch",
  totalCarbs: 40,
  byUser: { id: "u1", name: "Example" },
  items: [{ name: "Example food", carbs: 40 }],
};
const row = { mealId: "m1", ts, title: meal.title, totalCarbs: 40, stats };
const tile = {
  date: "2026-10-14",
  mealCount: 1,
  totalCarbs: 40,
  curve: [{ ts, mmol: 6 }],
  mealTimes: [ts],
};
const numbers = {
  lowEpisodes: { count: 0, atNight: 0 },
  carbsPerDay: 40,
  mealCount: 1,
  bolusLead: { registered: 0, of: 1 },
};
const curve = {
  meal,
  editItems: [{ name: "Example food", carbs: 40 }],
  window: { from: ts, to: ts },
  target,
  readings: [],
  stats,
  previous: [],
  neighbours: {},
  now: ts,
};
const day = {
  date: "2026-10-14",
  timezone: "Europe/Copenhagen",
  from: ts,
  to: ts,
  target,
  readings: [],
  inRange,
  totalCarbs: 40,
  mealCount: 1,
  meals: [{ ...meal, stats }],
  hasOlder: false,
  now: ts,
};
const week = {
  weekStart: "2026-10-12",
  weekEnd: "2026-10-19",
  isoWeek: 42,
  isoYear: 2026,
  timezone: day.timezone,
  target,
  days: Array.from({ length: 7 }, () => tile),
  numbers,
  meals: [row],
  now: ts,
};
const cases: [string, z.ZodType, unknown, unknown][] = [
  ["Target", history.Target, target, { low: 10, high: 4 }],
  ["InRange", history.InRange, inRange, { ...inRange, minutes: -1 }],
  ["MealStats", history.MealStats, stats, { ...stats, peak: { mmol: 9.6 } }],
  [
    "PreviousMealView",
    history.PreviousMealView,
    { ...row, readings: [] },
    { ...row, readings: [{ mmol: 6 }] },
  ],
  ["Neighbours", history.Neighbours, { previousMealId: "m0" }, { nextMealId: "" }],
  ["EditItem", history.EditItem, { name: "Example food", carbs: 40 }, { name: "", carbs: 40 }],
  [
    "MealCurveView",
    history.MealCurveView,
    curve,
    { ...curve, previous: Array.from({ length: 6 }, () => ({ ...row, readings: [] })) },
  ],
  ["DayHistoryMeal", history.DayHistoryMeal, { ...meal, stats }, { ...meal, stats: {} }],
  ["DayHistoryView", history.DayHistoryView, day, { ...day, hasOlder: undefined }],
  [
    "WeekDayTile",
    history.WeekDayTile,
    tile,
    { ...tile, curve: Array.from({ length: 49 }, () => ({ ts, mmol: 6 })) },
  ],
  ["WeekNumbers", history.WeekNumbers, numbers, { ...numbers, belowPercent: 101 }],
  ["MealStatsRow", history.MealStatsRow, row, { ...row, ts: "yesterday" }],
  ["WeekHistoryView", history.WeekHistoryView, week, { ...week, days: [] }],
];

describe("history contracts", () => {
  it.each(cases)(
    "exports strict %s with valid and invalid shapes",
    (name, schema, valid, invalid) => {
      expect(publicSchemas).toHaveProperty(name, schema);
      expect(schema.safeParse(valid).success).toBe(true);
      expect(schema.safeParse(invalid).success).toBe(false);
      expect(schema.safeParse({ ...(valid as object), unexpected: true }).success).toBe(false);
    },
  );
  it("carries pumpBolusId and fromPump on DayHistoryMeal and the meal curve, for owners and carers (v0.7.0 plan §4)", () => {
    const pumpMeal = { ...meal, stats, pumpBolusId: "b1", fromPump: true };
    expect(history.DayHistoryMeal.parse(pumpMeal)).toEqual(pumpMeal);
    expect(history.DayHistoryMeal.parse({ ...meal, stats })).not.toHaveProperty("pumpBolusId");
    expect(history.DayHistoryMeal.safeParse({ ...meal, stats, fromPump: false }).success).toBe(
      false,
    );
    expect(history.DayHistoryMeal.safeParse({ ...meal, stats, pumpBolusId: "" }).success).toBe(
      false,
    );
    // The history meal shows no units: they are read on meal detail, through MealView.
    expect(history.DayHistoryMeal.safeParse({ ...meal, stats, bolusUnits: 2.4 }).success).toBe(
      false,
    );
    const curveMeal = {
      ...meal,
      pumpBolusId: "b1",
      fromPump: true,
      bolusUnits: 2.4,
      pumpCarbs: 45,
    };
    expect(history.MealCurveView.parse({ ...curve, meal: curveMeal }).meal).toEqual(curveMeal);
  });
  it("rejects extra nested reading keys while keeping timestamps", () => {
    expect(
      history.MealCurveView.safeParse({
        ...curve,
        readings: [{ ts, mmol: 6, trend: "flat", extra: true }],
      }).success,
    ).toBe(false);
  });
  it("limits the statistics vocabulary recursively and at the type boundary", () => {
    expect(
      [...new Set(schemaVocabulary({ MealStats: history.MealStats }).map(([, key]) => key))].sort(),
    ).toEqual(
      [
        "peak",
        "mmol",
        "ts",
        "minutesAfterMeal",
        "inRange",
        "minutes",
        "coveredMinutes",
        "windowMinutes",
        "complete",
        "belowMinutes",
        "aboveMinutes",
        "bolusLeadMinutes",
        "readingCount",
      ].sort(),
    );
    expectTypeOf<keyof history.MealStats>().toEqualTypeOf<
      "peak" | "inRange" | "bolusLeadMinutes" | "readingCount"
    >();
    expectTypeOf<NonNullable<history.MealStats["peak"]>>().toEqualTypeOf<{
      mmol: number;
      ts: string;
      minutesAfterMeal: number;
    }>();
    expectTypeOf<keyof history.InRange>().toEqualTypeOf<
      "minutes" | "coveredMinutes" | "windowMinutes" | "complete" | "belowMinutes" | "aboveMinutes"
    >();
    expect(findDosingVocabulary(schemaVocabulary(history))).toEqual([]);
  });
  it("preserves the viewer contract and seven food/meal event payloads", () => {
    const keys = (schema: z.ZodType) =>
      schemaVocabulary({ root: schema }).map(([where, key]) => [where, key]);
    expect(keys(DayView)).toMatchInlineSnapshot(`
      [
        [
          "root.date",
          "date",
        ],
        [
          "root.timezone",
          "timezone",
        ],
        [
          "root.totalCarbs",
          "totalCarbs",
        ],
        [
          "root.mealCount",
          "mealCount",
        ],
        [
          "root.lastMealAt",
          "lastMealAt",
        ],
        [
          "root.meals",
          "meals",
        ],
        [
          "root.meals[].id",
          "id",
        ],
        [
          "root.meals[].ts",
          "ts",
        ],
        [
          "root.meals[].title",
          "title",
        ],
        [
          "root.meals[].slot",
          "slot",
        ],
        [
          "root.meals[].slot",
          "breakfast",
        ],
        [
          "root.meals[].slot",
          "lunch",
        ],
        [
          "root.meals[].slot",
          "dinner",
        ],
        [
          "root.meals[].slot",
          "snack",
        ],
        [
          "root.meals[].totalCarbs",
          "totalCarbs",
        ],
        [
          "root.meals[].byUser",
          "byUser",
        ],
        [
          "root.meals[].byUser.id",
          "id",
        ],
        [
          "root.meals[].byUser.name",
          "name",
        ],
        [
          "root.meals[].items",
          "items",
        ],
        [
          "root.meals[].items[].name",
          "name",
        ],
        [
          "root.meals[].items[].portionLabel",
          "portionLabel",
        ],
        [
          "root.meals[].items[].grams",
          "grams",
        ],
        [
          "root.meals[].items[].carbs",
          "carbs",
        ],
        [
          "root.meals[].photo",
          "photo",
        ],
        [
          "root.meals[].photo.thumbUrl",
          "thumbUrl",
        ],
        [
          "root.meals[].photo.originalUrl",
          "originalUrl",
        ],
        [
          "root.meals[].symbol",
          "symbol",
        ],
        [
          "root.meals[].symbol",
          "bread",
        ],
        [
          "root.meals[].symbol",
          "fruit",
        ],
        [
          "root.meals[].symbol",
          "vegetables",
        ],
        [
          "root.meals[].symbol",
          "dairy",
        ],
        [
          "root.meals[].symbol",
          "starch",
        ],
        [
          "root.meals[].symbol",
          "protein",
        ],
        [
          "root.meals[].symbol",
          "sweets",
        ],
        [
          "root.meals[].symbol",
          "snack",
        ],
        [
          "root.meals[].symbol",
          "drink",
        ],
        [
          "root.meals[].symbol",
          "mixed",
        ],
        [
          "root.meals[].symbol",
          "unknown",
        ],
      ]
    `);
    const eventKeys = Object.fromEntries(
      Object.entries(EventPayloads)
        .filter(([name]) => /^(food|meal)\./.test(name))
        .map(([name, schema]) => [name, keys(schema)]),
    );
    expect(eventKeys).toMatchInlineSnapshot(`
      {
        "food.contributed": [
          [
            "root.foodId",
            "foodId",
          ],
          [
            "root.source",
            "source",
          ],
        ],
        "food.created": [
          [
            "root.foodId",
            "foodId",
          ],
          [
            "root.origin",
            "origin",
          ],
        ],
        "food.deleted": [
          [
            "root.foodId",
            "foodId",
          ],
        ],
        "food.updated": [
          [
            "root.foodId",
            "foodId",
          ],
        ],
        "food.verified": [
          [
            "root.foodId",
            "foodId",
          ],
          [
            "root.verifiedBy",
            "verifiedBy",
          ],
        ],
        "meal.created": [
          [
            "root.mealId",
            "mealId",
          ],
          [
            "root.ts",
            "ts",
          ],
          [
            "root.totalCarbs",
            "totalCarbs",
          ],
        ],
        "meal.deleted": [
          [
            "root.mealId",
            "mealId",
          ],
        ],
        "meal.updated": [
          [
            "root.mealId",
            "mealId",
          ],
        ],
      }
    `);
    const forbidden = new Set([
      "mmol",
      "mgdl",
      "trend",
      "reading",
      "readings",
      "glucose",
      "peak",
      "inRange",
      "inRangePercent",
      "stats",
      "curve",
      "bolusTs",
      "bolusLead",
      "bolusLeadMinutes",
      // v0.7.0: the pump record is glucose-side data; the viewer's day gains none of it.
      "units",
      "bolusUnits",
      "pumpCarbs",
      "pumpBolusId",
      "fromPump",
      "kind",
      "pump",
      "source",
      "reach",
    ]);
    expect(keys(DayView).filter(([, key]) => forbidden.has(key ?? ""))).toEqual([]);
    expect(keys(DayView).filter(([, key]) => /pump/i.test(key ?? ""))).toEqual([]);
  });
  it("keeps statistics independent of clocks, frameworks, conversions and regional constants", () => {
    const dir = new URL("../stats/", import.meta.url);
    const sources = readdirSync(dir)
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
      .map((name) => readFileSync(new URL(name, dir), "utf8"))
      .join("\n");
    expect(sources).not.toMatch(/\b(?:unit|units|ratio|dose|correction)\b/i);
    expect(sources).not.toMatch(/Date\.now\s*\(|Europe\/|America\/|["'](?:da|en)["']/);
    expect(sources).not.toMatch(
      /(?:from\s*|import\s*\()["'][^"']*(?:prisma|web\/|glucose\/units|react|next|azure|provider)/i,
    );
  });
});

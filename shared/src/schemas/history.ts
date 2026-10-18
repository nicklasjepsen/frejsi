import { z } from "zod";
import { MealSymbol, Portion } from "./food";
import { Reading } from "./glucose";
import { DayMealView, DayView, MealItemView, MealView } from "./meal";

// All history views carry glucose and are for owners/carers only. DayView remains separate.
const minutes = z.number().nonnegative();
const count = z.number().int().nonnegative();
const percent = z.number().min(0).max(100);
const timestamp = z.iso.datetime();
const reading = Reading.strict();
const point = z.strictObject({ ts: timestamp, mmol: z.number().min(0).max(40) });
const window = z.strictObject({ from: timestamp, to: timestamp });

export const Target = z
  .strictObject({ low: z.number().min(0).max(40), high: z.number().min(0).max(40) })
  .refine((value) => value.low <= value.high, "Target bounds are reversed");
export type Target = z.infer<typeof Target>;
export const InRange = z.strictObject({
  minutes,
  coveredMinutes: minutes,
  windowMinutes: minutes,
  complete: z.boolean(),
  belowMinutes: minutes,
  aboveMinutes: minutes,
});
export type InRange = z.infer<typeof InRange>;
export const MealStats = z.strictObject({
  peak: z
    .strictObject({ ...point.shape, minutesAfterMeal: z.number().int().nonnegative() })
    .optional(),
  inRange: InRange,
  bolusLeadMinutes: z.number().int().optional(),
  readingCount: count,
});
export type MealStats = z.infer<typeof MealStats>;
const rowFields = {
  mealId: z.string().min(1),
  ts: timestamp,
  title: z.string().min(1),
  totalCarbs: count,
  bolusLeadMinutes: z.number().int().optional(),
  stats: MealStats,
};
export const PreviousMealView = z.strictObject({ ...rowFields, readings: z.array(reading) });
export type PreviousMealView = z.infer<typeof PreviousMealView>;
export const Neighbours = z.strictObject({
  previousMealId: z.string().min(1).optional(),
  nextMealId: z.string().min(1).optional(),
});
export type Neighbours = z.infer<typeof Neighbours>;
export const EditItem = MealItemView.extend({
  foodId: z.string().min(1).optional(),
  portions: z.array(Portion).optional(),
  carbsPer100g: z.number().min(0).max(100).optional(),
});
export type EditItem = z.infer<typeof EditItem>;
export const MealCurveView = z.strictObject({
  meal: MealView,
  editItems: z.array(EditItem).min(1).max(30),
  window,
  target: Target,
  readings: z.array(reading),
  stats: MealStats,
  previous: z.array(PreviousMealView).max(5),
  neighbours: Neighbours,
  now: timestamp,
});
export type MealCurveView = z.infer<typeof MealCurveView>;
export const DayHistoryMeal = DayMealView.extend({
  bolusTs: timestamp.optional(),
  stats: MealStats,
  /** The curve draws a meal's bolus once by its id; `fromPump` is the pump-meal badge (v0.7.0). */
  pumpBolusId: z.string().min(1).optional(),
  fromPump: z.literal(true).optional(),
});
export type DayHistoryMeal = z.infer<typeof DayHistoryMeal>;
export const DayHistoryView = z.strictObject({
  date: z.iso.date(),
  timezone: DayView.shape.timezone,
  from: timestamp,
  to: timestamp,
  target: Target,
  readings: z.array(reading),
  inRange: InRange,
  totalCarbs: count,
  mealCount: count,
  meals: z.array(DayHistoryMeal),
  hasOlder: z.boolean(),
  now: timestamp,
});
export type DayHistoryView = z.infer<typeof DayHistoryView>;
export const WeekDayTile = z.strictObject({
  date: z.iso.date(),
  mealCount: count,
  totalCarbs: count,
  inRangePercent: percent.optional(),
  curve: z.array(point).max(48),
  mealTimes: z.array(timestamp),
  /** The same meals as `mealTimes` with their symbol (v0.6.0); `mealTimes` stays, append-only. */
  meals: z.array(z.strictObject({ ts: timestamp, symbol: MealSymbol })).default([]),
});
export type WeekDayTile = z.infer<typeof WeekDayTile>;
export const WeekNumbers = z.strictObject({
  inRangePercent: percent.optional(),
  previousWeekInRangePercent: percent.optional(),
  belowPercent: percent.optional(),
  lowEpisodes: z.strictObject({ count, atNight: count }),
  carbsPerDay: count,
  mealCount: count,
  bolusLead: z.strictObject({
    meanMinutes: z.number().int().optional(),
    registered: count,
    of: count,
  }),
});
export type WeekNumbers = z.infer<typeof WeekNumbers>;
export const MealStatsRow = z.strictObject(rowFields);
export type MealStatsRow = z.infer<typeof MealStatsRow>;
export const WeekHistoryView = z.strictObject({
  weekStart: z.iso.date(),
  weekEnd: z.iso.date(),
  isoWeek: z.number().int().min(1).max(53),
  isoYear: z.number().int().min(1).max(9999),
  timezone: DayView.shape.timezone,
  target: Target,
  days: z.array(WeekDayTile).length(7),
  numbers: WeekNumbers,
  meals: z.array(MealStatsRow),
  now: timestamp,
});
export type WeekHistoryView = z.infer<typeof WeekHistoryView>;

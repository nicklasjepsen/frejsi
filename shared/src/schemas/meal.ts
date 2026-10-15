import { z } from "zod";

import { FoodPhoto } from "./food";

const itemFields = {
  name: z.string().trim().min(1).max(200),
  portionLabel: z.string().min(1).max(40).optional(),
  grams: z.number().min(1).max(5000).optional(),
  carbs: z.number().int().min(0).max(1000),
};
export const MealItemInput = z
  .strictObject({
    ...itemFields,
    foodId: z.string().min(1).optional(),
    carbs: itemFields.carbs.optional(),
  })
  .refine(
    (value) => value.foodId !== undefined || value.carbs !== undefined,
    "Manual items need carbs",
  );
export type MealItemInput = z.infer<typeof MealItemInput>;

const requestFields = {
  ts: z.iso.datetime().optional(),
  items: z.array(MealItemInput).min(1).max(30),
  note: z.string().max(500).optional(),
  bolusTs: z.iso.datetime().optional(),
  photoDataUrl: z.string().startsWith("data:image/").optional(),
};
export const CreateMealRequest = z.strictObject(requestFields);
export type CreateMealRequest = z.infer<typeof CreateMealRequest>;
export const UpdateMealRequest = z
  .strictObject({
    ...requestFields,
    // Omitted means unchanged; null explicitly clears a saved timestamp.
    bolusTs: z.iso.datetime().nullable().optional(),
  })
  .partial();
export type UpdateMealRequest = z.infer<typeof UpdateMealRequest>;
export const MealItemView = z.strictObject(itemFields);
export type MealItemView = z.infer<typeof MealItemView>;
export const MealSlot = z.enum(["breakfast", "lunch", "dinner", "snack"]);
export type MealSlot = z.infer<typeof MealSlot>;
const viewFields = {
  id: z.string().min(1),
  ts: z.iso.datetime(),
  title: z.string().min(1),
  slot: MealSlot,
  totalCarbs: z.number().int().min(0).max(30000),
  byUser: z.strictObject({ id: z.string().min(1), name: z.string().min(1) }),
  items: z.array(MealItemView).min(1).max(30),
  photo: FoodPhoto.optional(),
};
export const MealView = z.strictObject({
  ...viewFields,
  bolusTs: z.iso.datetime().optional(),
  note: z.string().max(500).optional(),
});
export type MealView = z.infer<typeof MealView>;
export const DayMealView = z.strictObject(viewFields);
export type DayMealView = z.infer<typeof DayMealView>;
export const DayView = z.strictObject({
  date: z.iso.date(),
  timezone: z.string().refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Invalid timezone"),
  totalCarbs: z.number().int().nonnegative(),
  mealCount: z.number().int().nonnegative(),
  lastMealAt: z.iso.datetime().optional(),
  meals: z.array(DayMealView),
});
export type DayView = z.infer<typeof DayView>;

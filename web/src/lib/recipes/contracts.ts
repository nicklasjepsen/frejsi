// The request shapes of the recipes routes, composed from the shared contracts (task 1): the
// reviewed lines, the yield and the source go in as they come out of RecipeReview. Pure Zod, so
// the client component imports it too.
import { z } from "zod";
import { FoodCategory, RecipeIngredient, RecipeSource } from "@frejsi/shared/schemas/food";

const title = z.string().trim().min(1).max(200);
const ingredients = z.array(RecipeIngredient).min(1).max(40);
const yieldGrams = z.number().min(1).max(100_000);
const yieldPortions = z.number().min(0.5).max(1000);
/** The two portion names the person may rename ("1 portion", "½ portion" by default). */
const portionLabels = z.strictObject({
  one: z.string().trim().min(1).max(40),
  half: z.string().trim().min(1).max(40),
});
const hasYield = (value: { yieldGrams?: number | undefined; yieldPortions?: number | undefined }) =>
  value.yieldGrams !== undefined || value.yieldPortions !== undefined;
const yieldError = { message: "A recipe needs a yield in grams or portions", path: ["yieldGrams"] };

/** `POST recipes`: everything the review form holds; the route computes the food from it. */
export const SaveRecipeRequest = z
  .strictObject({
    title,
    ingredients,
    yieldGrams: yieldGrams.optional(),
    yieldPortions: yieldPortions.optional(),
    source: RecipeSource,
    portionLabels: portionLabels.optional(),
    category: FoodCategory.optional(),
    photoDataUrl: z.string().startsWith("data:image/jpeg;base64,").optional(),
  })
  .refine(hasYield, yieldError);
export type SaveRecipeRequest = z.infer<typeof SaveRecipeRequest>;

/** `PATCH recipes/[foodId]`: the edited lines or yield; omitted means unchanged. */
export const RecalcRecipeRequest = z
  .strictObject({
    title: title.optional(),
    ingredients: ingredients.optional(),
    // null clears a yield the person no longer wants; the other one must then be set.
    yieldGrams: yieldGrams.nullable().optional(),
    yieldPortions: yieldPortions.nullable().optional(),
    portionLabels: portionLabels.optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), "Nothing to change");
export type RecalcRecipeRequest = z.infer<typeof RecalcRecipeRequest>;

/** What `GET /api/share/[id]` hands the form, once. */
export const SharedRecipe = z.strictObject({
  title: z.string().max(500).optional(),
  text: z.string().max(4000).optional(),
  url: z.url().startsWith("https://").max(2000).optional(),
  photoDataUrl: z.string().startsWith("data:image/jpeg;base64,").optional(),
});
export type SharedRecipe = z.infer<typeof SharedRecipe>;

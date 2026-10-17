import {
  type FoodView,
  HttpError,
  RecipeReview,
  lookup,
  type MealView,
  type RecipeIngredient,
  type RecipeSource,
  type SessionContext,
} from "@frejsi/shared";
import { computeRecipe, type PortionLabels } from "@frejsi/shared/ai/recipe/compute";
import {
  resolveIngredients,
  type ParsedLine,
  type RecipeLookup,
  type ResolvedLine,
} from "@frejsi/shared/ai/recipe/ingredients";
import { canonicalUnit, parseIngredientLine } from "@frejsi/shared/ai/recipe/jsonld";
import { fetchRecipePage } from "@frejsi/shared/ai/recipe/page";
import type { RecipeInput } from "@frejsi/shared/ai/recipe/parse";
import { RecipeParseRequest } from "@frejsi/shared/schemas/ai";
import { estimateImage } from "@/ai/estimate/photo";
import { readRecipe } from "@/ai/recipe/service";
import { assertRole } from "@/lib/auth/session";
import { createFood, getFood, setFoodPhoto, updateFood } from "@/lib/foods";
import { resolveFoods, type FoodDeps, type ResolvedFoods } from "@/lib/foods/core";
import { getMessages } from "@/lib/i18n/messages";
import { getMeal } from "@/lib/meals/service";
import { RecalcRecipeRequest, SaveRecipeRequest } from "./contracts";

export interface RecipeDeps extends FoodDeps {
  /** The page fetch; a fixture in tests. Runs only inside the explicit parse request. */
  fetchPage?: typeof fetchRecipePage;
  /** The meal behind "Gem som opskrift"; the meals service by default. */
  meal?: (spaceId: string, session: SessionContext, mealId: string) => Promise<MealView>;
}
let overrides: RecipeDeps = {};
/** Tests only. */
export function configureRecipes(deps: RecipeDeps): void {
  overrides = deps;
}
function resolve(input: RecipeDeps) {
  const all = { ...overrides, ...input };
  return {
    foods: resolveFoods(all),
    fetchPage: all.fetchPage ?? fetchRecipePage,
    meal:
      all.meal ??
      ((spaceId: string, session: SessionContext, mealId: string) =>
        getMeal(spaceId, mealId, session.locale)),
  };
}

function authorize(spaceId: string, session: SessionContext): void {
  assertRole(session, spaceId, "owner", "carer");
  // simpleMode shows verified foods only; a dish from a recipe is unverified by definition.
  if (session.simpleMode) throw new HttpError(400, "simple-mode");
}
function parse<T>(schema: { safeParse: (value: unknown) => { success: boolean; data?: T } }, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success || result.data === undefined) throw new HttpError(400, "validation");
  return result.data;
}
function labelsFor(session: SessionContext, given?: PortionLabels): PortionLabels {
  return given ?? getMessages(session.locale).recipe.portion;
}

/**
 * The lookup every line goes through: the shared `lookup()` in its normal order (library, cache,
 * sources) with `remote: true` and `simpleMode: false` (the route refused a simpleMode session
 * already), keyword only, so an ingredient costs no embedding call.
 */
function lookupFor(spaceId: string, session: SessionContext, deps: ResolvedFoods): RecipeLookup {
  return (q) =>
    lookup(deps.repo, deps.sources, {
      spaceId,
      session: { simpleMode: false },
      locale: session.locale,
      query: { q, remote: true },
      embed: null,
    });
}

async function review(
  spaceId: string,
  session: SessionContext,
  deps: ResolvedFoods,
  parsed: { title: string; ingredients: ParsedLine[]; yieldPortions?: number | undefined; yieldGrams?: number | undefined },
  source: RecipeSource,
  approx: boolean,
): Promise<RecipeReview> {
  const lines = await resolveIngredients(parsed.ingredients, lookupFor(spaceId, session, deps));
  return reviewOf(parsed.title, lines, parsed, source, approx);
}
function reviewOf(
  title: string,
  lines: ResolvedLine[],
  yields: { yieldPortions?: number | undefined; yieldGrams?: number | undefined },
  source: RecipeSource,
  approx: boolean,
): RecipeReview {
  return RecipeReview.parse({
    title: title.slice(0, 120),
    lines,
    totalCarbs: lines.reduce((sum, line) => sum + line.carbs, 0),
    ...(yields.yieldPortions === undefined ? {} : { yieldPortions: yields.yieldPortions }),
    ...(yields.yieldGrams === undefined ? {} : { yieldGrams: yields.yieldGrams }),
    source,
    approx,
  });
}

/**
 * `POST recipes/parse`: one way in, the explicit tap. A URL is fetched here and only here; the
 * text or the photo reaches the model through `readRecipe`. Nothing is saved.
 */
export async function reviewRecipe(
  spaceId: string,
  session: SessionContext,
  body: unknown,
  input: RecipeDeps = {},
): Promise<RecipeReview> {
  authorize(spaceId, session);
  if (typeof body === "object" && body !== null && "photoDataUrl" in body) {
    // The image is checked before the request contract, as the estimate does: a clear 400.
    await estimateImage(body.photoDataUrl);
  }
  const request = parse(RecipeParseRequest, body);
  const deps = resolve(input);
  let recipeInput: RecipeInput;
  let source: RecipeSource;
  if ("url" in request) {
    const html = await deps.fetchPage(request.url, {
      log: (message, fields) => {
        deps.foods.log.warn(message, { spaceId, code: fields.code });
      },
    });
    recipeInput = { kind: "html", html };
    source = { kind: "url", url: request.url };
  } else if ("text" in request) {
    recipeInput = { kind: "text", text: request.text };
    source = { kind: "text", text: request.text };
  } else {
    const bytes = await estimateImage(request.photoDataUrl);
    recipeInput = { kind: "photo", base64: Buffer.from(bytes).toString("base64") };
    source = { kind: "photo" };
  }
  const parsed = await readRecipe(spaceId, session, recipeInput);
  return review(spaceId, session, deps.foods, parsed.parse, source, parsed.approx);
}

/** The meal's items as lines, the eaten amounts as the yield of one portion (`source.kind: "meal"`). */
export async function recipeFromMeal(
  spaceId: string,
  session: SessionContext,
  mealId: string,
  input: RecipeDeps = {},
): Promise<RecipeReview> {
  authorize(spaceId, session);
  const deps = resolve(input);
  const meal = await deps.meal(spaceId, session, mealId);
  const lines: ResolvedLine[] = [];
  for (const item of meal.items) {
    const amount =
      item.grams !== undefined
        ? { amount: item.grams, unit: "g" }
        : item.portionLabel
          ? portionAmount(item.portionLabel)
          : null;
    const food =
      item.grams !== undefined || !item.portionLabel
        ? null
        : ((await deps.foods.db.food.findFirst({
            where: { spaceId, name: item.name },
            select: { id: true },
          })) ?? null);
    lines.push({
      name: item.name,
      ...(amount?.amount === undefined ? {} : { amount: amount.amount }),
      ...(amount?.unit === undefined ? {} : { unit: amount.unit }),
      ...(item.grams === undefined ? {} : { grams: item.grams }),
      ...(food ? { foodId: food.id } : {}),
      foodName: item.name,
      carbs: item.carbs,
    });
  }
  const grams = meal.items.every((item) => item.grams !== undefined)
    ? meal.items.reduce((sum, item) => sum + (item.grams ?? 0), 0)
    : undefined;
  return reviewOf(
    meal.title,
    lines,
    { yieldPortions: 1, ...(grams === undefined || grams < 1 ? {} : { yieldGrams: grams }) },
    { kind: "meal", mealId: meal.id },
    false,
  );
}

/** "2 slices" → 2 slice; "1 portion" → 1 portion: a portion label is an amount and a unit, no name. */
function portionAmount(label: string): { amount?: number; unit?: string } | null {
  const parsed = parseIngredientLine(label);
  if (parsed?.amount === undefined) return null;
  const unit = parsed.unit ?? canonicalUnit(parsed.name)?.unit ?? parsed.name.slice(0, 20);
  return { amount: parsed.amount, unit };
}

function foodFields(
  session: SessionContext,
  fields: { title: string; ingredients: RecipeIngredient[]; yieldGrams?: number | undefined; yieldPortions?: number | undefined; source: RecipeSource; portionLabels?: PortionLabels | undefined },
) {
  const totals = computeRecipe(fields.ingredients, fields, labelsFor(session, fields.portionLabels));
  return {
    name: fields.title,
    ...(totals.carbsPer100g === undefined ? {} : { carbsPer100g: totals.carbsPer100g }),
    portions: totals.portions,
    recipe: {
      ingredients: fields.ingredients,
      ...(fields.yieldGrams === undefined ? {} : { yieldGrams: fields.yieldGrams }),
      ...(fields.yieldPortions === undefined ? {} : { yieldPortions: fields.yieldPortions }),
      source: fields.source,
    },
  };
}

/**
 * "Gem": the dish through `createFood` with origin `recipe`, `verified: false`, the computed
 * carbs per 100 g and portions, the recipe JSON with its source; then the photo through
 * `setFoodPhoto`. Both emit; nothing else writes.
 */
export async function saveRecipe(
  spaceId: string,
  session: SessionContext,
  body: unknown,
  input: RecipeDeps = {},
): Promise<FoodView> {
  authorize(spaceId, session);
  const fields = parse(SaveRecipeRequest, body);
  const deps = resolve(input);
  const food = foodFields(session, fields);
  if (food.carbsPer100g === undefined && food.portions.length === 0)
    throw new HttpError(400, "validation");
  let saved = await createFood(
    spaceId,
    session,
    {
      ...food,
      ...(fields.category ? { category: fields.category } : {}),
      origin: "recipe",
      from: "library",
      verify: false,
    },
    deps.foods,
  );
  if (fields.photoDataUrl) {
    const bytes = await estimateImage(fields.photoDataUrl);
    saved = await setFoodPhoto(spaceId, session, saved.id, bytes, deps.foods);
  }
  return saved;
}

/**
 * `PATCH recipes/[foodId]`: the edited lines or yield recalculate carbs per 100 g and the
 * portions through `updateFood`. A past meal keeps its MealItem snapshots untouched.
 */
export async function recalcRecipe(
  spaceId: string,
  session: SessionContext,
  foodId: string,
  body: unknown,
  input: RecipeDeps = {},
): Promise<FoodView> {
  authorize(spaceId, session);
  const patch = parse(RecalcRecipeRequest, body);
  const deps = resolve(input);
  const current = await getFood(spaceId, session, foodId, deps.foods);
  if (current.origin !== "recipe" || !current.recipe) throw new HttpError(400, "validation");
  const yieldGrams = patch.yieldGrams === undefined ? current.recipe.yieldGrams : (patch.yieldGrams ?? undefined);
  const yieldPortions =
    patch.yieldPortions === undefined ? current.recipe.yieldPortions : (patch.yieldPortions ?? undefined);
  if (yieldGrams === undefined && yieldPortions === undefined) throw new HttpError(400, "validation");
  const labels = patch.portionLabels ?? labelsFromPortions(current, session);
  const food = foodFields(session, {
    title: patch.title ?? current.name,
    ingredients: patch.ingredients ?? current.recipe.ingredients,
    ...(yieldGrams === undefined ? {} : { yieldGrams }),
    ...(yieldPortions === undefined ? {} : { yieldPortions }),
    source: current.recipe.source,
    portionLabels: labels,
  });
  if (food.carbsPer100g === undefined && food.portions.length === 0)
    throw new HttpError(400, "validation");
  return updateFood(
    spaceId,
    session,
    foodId,
    { ...food, carbsPer100g: food.carbsPer100g ?? null },
    deps.foods,
  );
}

/** The names the dish's two portions carry today, so a recalc keeps a renamed portion. */
function labelsFromPortions(food: FoodView, session: SessionContext): PortionLabels {
  const defaults = labelsFor(session);
  const [one, half] = food.portions;
  return { one: one?.label ?? defaults.one, half: half?.label ?? defaults.half };
}

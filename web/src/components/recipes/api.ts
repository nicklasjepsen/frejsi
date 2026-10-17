// The browser side of the recipes routes and the share receiver: one typed function per call,
// every answer validated against the shared contracts. Schema modules only (this is bundled for
// the browser; the @frejsi/shared barrel also exports Prisma).
import { RecipeParseRequest } from "@frejsi/shared/schemas/ai";
import { ApiError, type ApiErrorCode } from "@frejsi/shared/schemas/api";
import { FoodView, RecipeReview } from "@frejsi/shared/schemas/food";
import type { z } from "zod";
import { RecalcRecipeRequest, SaveRecipeRequest, SharedRecipe } from "@/lib/recipes/contracts";

export class RecipeApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
  ) {
    super(code);
    this.name = "RecipeApiError";
  }
}

const base = (spaceId: string) => `/api/spaces/${encodeURIComponent(spaceId)}/recipes`;

async function send(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: init.method ?? "GET",
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  } catch {
    throw new RecipeApiError(0, "internal");
  }
  const json: unknown = await response.json().catch(() => null);
  if (response.ok) return json;
  const parsed = ApiError.safeParse(json);
  throw new RecipeApiError(response.status, parsed.success ? parsed.data.error.code : "internal");
}
function read<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new RecipeApiError(200, "internal");
  return parsed.data;
}

export const recipeApi = {
  /** The explicit tap: one way in. The route fetches the URL or sends the text or photo to the model. */
  parse: async (spaceId: string, request: RecipeParseRequest): Promise<RecipeReview> =>
    read(
      RecipeReview,
      await send(`${base(spaceId)}/parse`, {
        method: "POST",
        body: RecipeParseRequest.parse(request),
      }),
    ),
  /** "Gem som opskrift": the meal's items as lines. No model call. */
  fromMeal: async (spaceId: string, mealId: string): Promise<RecipeReview> =>
    read(RecipeReview, await send(`${base(spaceId)}/meal/${encodeURIComponent(mealId)}`)),
  /** "Gem": the dish of origin recipe, unverified, through the route's createFood. */
  save: async (spaceId: string, request: SaveRecipeRequest): Promise<FoodView> =>
    read(
      FoodView,
      await send(base(spaceId), { method: "POST", body: SaveRecipeRequest.parse(request) }),
    ),
  /** An edited line or yield recalculates the dish; past meals keep their snapshots. */
  recalc: async (
    spaceId: string,
    foodId: string,
    request: RecalcRecipeRequest,
  ): Promise<FoodView> =>
    read(
      FoodView,
      await send(`${base(spaceId)}/${encodeURIComponent(foodId)}`, {
        method: "PATCH",
        body: RecalcRecipeRequest.parse(request),
      }),
    ),
  /** The share the phone posted, once. */
  takeShare: async (shareId: string): Promise<SharedRecipe> =>
    read(SharedRecipe, await send(`/api/share/${encodeURIComponent(shareId)}`)),
};

import { json, parseBody } from "@/app/api/auth/http";
import { RecalcRecipeRequest } from "@/lib/recipes/contracts";
import { recipeRoute } from "@/lib/recipes/server";
import { recalcRecipe } from "@/lib/recipes/service";

/** An edited line or yield recalculates the dish; past meals keep their snapshots. */
export const PATCH = recipeRoute("recipes.recalc", async (request, context) => {
  const patch = await parseBody(request, RecalcRecipeRequest);
  const food = await recalcRecipe(context.spaceId, context.session, context.foodId, patch);
  context.count = 1;
  return json(food);
});

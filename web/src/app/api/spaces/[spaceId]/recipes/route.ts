import { json } from "@/app/api/auth/http";
import { recipeBody, recipeRoute } from "@/lib/recipes/server";
import { saveRecipe } from "@/lib/recipes/service";

/** "Gem": the dish of origin `recipe`, through createFood and setFoodPhoto. */
export const POST = recipeRoute("recipes.create", async (request, context) => {
  const food = await saveRecipe(context.spaceId, context.session, await recipeBody(request));
  context.count = 1;
  return json(food, { status: 201 });
});

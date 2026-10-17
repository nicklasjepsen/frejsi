import { json } from "@/app/api/auth/http";
import { recipeBody, recipeRoute } from "@/lib/recipes/server";
import { reviewRecipe } from "@/lib/recipes/service";

/** The explicit tap: a URL, pasted text or a photo becomes a RecipeReview. Nothing is saved. */
export const POST = recipeRoute("recipes.parse", async (request, context) => {
  const review = await reviewRecipe(context.spaceId, context.session, await recipeBody(request));
  context.count = review.lines.length;
  return json(review);
});

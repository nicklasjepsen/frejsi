import { json, settingsRoute } from "@/components/settings/api-route";
import { resolveFoods } from "@/lib/foods/core";
import { requireSpaceRole } from "@/lib/live/server";
import { recipeFromMeal } from "@/lib/recipes/service";

/** "Gem som opskrift": the meal's items as lines, its amounts as one portion. No model call. */
export const GET = settingsRoute<{ spaceId: string; mealId: string }>(
  "recipes.from-meal",
  async (request, { spaceId, mealId }) => {
    const deps = resolveFoods();
    const { session } = await requireSpaceRole(
      request,
      spaceId,
      ["owner", "carer"],
      deps.sessionDb,
      deps.now,
    );
    return json(await recipeFromMeal(spaceId, session, mealId));
  },
);

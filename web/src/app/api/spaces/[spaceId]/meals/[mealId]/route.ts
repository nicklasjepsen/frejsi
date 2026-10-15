import { UpdateMealRequest } from "@frejsi/shared";
import { noContent } from "@/app/api/auth/http";
import { json, parseBody, settingsRoute } from "@/components/settings/api-route";
import { authorizeMeal, mealOutcome } from "@/lib/meals/server";
import { deleteMeal, getMeal, updateMeal } from "@/lib/meals/service";

interface Params {
  spaceId: string;
  mealId: string;
}
export const GET = settingsRoute<Params>("meals.get", async (request, { spaceId, mealId }) => {
  const { session, deps } = await authorizeMeal(request, spaceId);
  const meal = await getMeal(spaceId, mealId, session.locale, deps);
  mealOutcome(spaceId, session.userId, meal.items.length);
  return json(meal);
});
export const PATCH = settingsRoute<Params>("meals.update", async (request, { spaceId, mealId }) => {
  const { session, deps } = await authorizeMeal(request, spaceId);
  const meal = await updateMeal(
    spaceId,
    mealId,
    session,
    await parseBody(request, UpdateMealRequest),
    deps,
  );
  mealOutcome(spaceId, session.userId, meal.items.length);
  return json(meal);
});
export const DELETE = settingsRoute<Params>(
  "meals.delete",
  async (request, { spaceId, mealId }) => {
    const { session, deps } = await authorizeMeal(request, spaceId);
    await deleteMeal(spaceId, mealId, deps);
    mealOutcome(spaceId, session.userId, 1);
    return noContent();
  },
);

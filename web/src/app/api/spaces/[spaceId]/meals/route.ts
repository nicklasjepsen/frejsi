import { CreateMealRequest } from "@frejsi/shared";
import { json, parseBody } from "@/app/api/auth/http";
import { spaceRoute } from "@/lib/live/server";
import { authorizeMeal, mealOutcome } from "@/lib/meals/server";
import { createMeal } from "@/lib/meals/service";

export const POST = spaceRoute("meals.create", async (request, spaceId) => {
  const { session, deps } = await authorizeMeal(request, spaceId);
  const body = await parseBody(request, CreateMealRequest);
  const meal = await createMeal(spaceId, session, body, deps);
  mealOutcome(spaceId, session.userId, meal.items.length);
  return json(meal, { status: 201 });
});

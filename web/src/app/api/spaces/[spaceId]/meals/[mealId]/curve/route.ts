import { route } from "@/app/api/auth/http";
import { authorizeHistory, historyResponse } from "@/lib/history/server";
import { loadMealCurve } from "@/lib/history/meal-curve";
const ROUTE = "spaces.meals.curve";
export function GET(
  request: Request,
  context: { params: Promise<{ spaceId: string; mealId: string }> },
): Promise<Response> {
  return route(ROUTE, async (request) => {
    const { spaceId, mealId } = await context.params;
    const { session, deps } = await authorizeHistory(request, spaceId);
    const view = await loadMealCurve(spaceId, mealId, session.locale, deps);
    return historyResponse(ROUTE, spaceId, session.userId, view.readings.length, view);
  })(request);
}

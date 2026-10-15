import { spaceRoute } from "@/lib/live/server";
import { authorizeHistory, historyDate, historyResponse } from "@/lib/history/server";
import { loadHistoryWeek } from "@/lib/history/week";
const ROUTE = "spaces.history.week";
export const GET = spaceRoute(ROUTE, async (request, spaceId) => {
  const { session, deps } = await authorizeHistory(request, spaceId);
  const view = await loadHistoryWeek(spaceId, historyDate(request, "start"), session.locale, deps);
  return historyResponse(ROUTE, spaceId, session.userId, view.meals.length, view);
});

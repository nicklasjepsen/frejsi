import { spaceRoute } from "@/lib/live/server";
import {
  authorizeHistory,
  historyDate,
  historyResponse,
  includeReadings,
} from "@/lib/history/server";
import { loadHistoryDay } from "@/lib/history/day";
const ROUTE = "spaces.history.day";
export const GET = spaceRoute(ROUTE, async (request, spaceId) => {
  const { session, deps } = await authorizeHistory(request, spaceId);
  const view = await loadHistoryDay(
    spaceId,
    historyDate(request, "date"),
    includeReadings(request),
    session.locale,
    deps,
  );
  return historyResponse(ROUTE, spaceId, session.userId, view.mealCount, view);
});

import { DEFAULT_WINDOW_HOURS, WindowHours } from "@/lib/live/contracts";
import {
  json,
  liveDeps,
  loadReadingsWindow,
  log,
  queryNumber,
  requireSpaceRole,
  spaceRoute,
} from "@/lib/live/server";

const ROUTE = "spaces.readings";

/**
 * The readings of the last `hours` hours (1..24, default 24) with the space's rendering settings
 * and the cursor they are consistent with (plan §5). Owners and carers only: a viewer is 403 here,
 * in the API, whatever the UI does.
 */
export const GET = spaceRoute(ROUTE, async (request, spaceId) => {
  const { db, now } = liveDeps();
  const { session } = await requireSpaceRole(request, spaceId, ["owner", "carer"], db, now);
  const hours = queryNumber(request, "hours", WindowHours, DEFAULT_WINDOW_HOURS);
  const window = await loadReadingsWindow(spaceId, hours, { db, now });
  log.info("live.readings", {
    route: ROUTE,
    spaceId,
    userId: session.userId,
    count: window.readings.length,
  });
  return json(window);
});

import { SinceSeq } from "@/lib/live/contracts";
import {
  json,
  liveDeps,
  loadEventsPage,
  log,
  queryNumber,
  requireSpaceRole,
  spaceRoute,
} from "@/lib/live/server";

const ROUTE = "spaces.events";

/**
 * The events after `since` in sequence order, for catch-up on connect and for polling (plan §5).
 * The role filter is applied in the query: a viewer's page never carries a `reading`.
 */
export const GET = spaceRoute(ROUTE, async (request, spaceId) => {
  const { db } = liveDeps();
  const { session, role } = await requireSpaceRole(request, spaceId, [], db);
  const since = queryNumber(request, "since", SinceSeq, 0);
  const page = await loadEventsPage(spaceId, since, role, db);
  log.info("live.events", {
    route: ROUTE,
    spaceId,
    userId: session.userId,
    count: page.events.length,
  });
  return json(page);
});

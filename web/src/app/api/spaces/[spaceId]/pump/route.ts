import { HttpError, PumpRangeQuery } from "@frejsi/shared";

import { json, log, spaceRoute } from "@/lib/live/server";
import { loadPumpHistory } from "@/lib/pump/history";
import { authorizePump, pumpDeps } from "@/lib/pump/server";

const ROUTE = "spaces.pump";

/**
 * The pump record between `from` and `to` (at most eight days; v0.7.0 plan §4): the boluses oldest
 * first with the meal each belongs to, how far the record reaches and its status. Owners and carers
 * outside simpleMode only: a viewer and a simpleMode session are 403 here, before the range is
 * read. Recorded units go out as history; nothing is calculated from them. The log line carries
 * the ids and a count, never units, carbs or a time.
 */
export const GET = spaceRoute(ROUTE, async (request, spaceId) => {
  const deps = pumpDeps();
  const session = await authorizePump(request, spaceId, deps);
  const params = new URL(request.url).searchParams;
  const range = PumpRangeQuery.safeParse({
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
  });
  if (!range.success) throw new HttpError(400, "validation");
  const view = await loadPumpHistory(
    spaceId,
    new Date(range.data.from),
    new Date(range.data.to),
    deps.db,
  );
  log.info("pump.history", {
    route: ROUTE,
    spaceId,
    userId: session.userId,
    count: view.boluses.length,
  });
  return json(view);
});

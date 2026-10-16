import { HttpError } from "@frejsi/shared";

import { parseBody } from "@/app/api/auth/http";
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

import { addManualReading, ManualReadingBody, readingDeps } from "@/lib/readings/service";

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

/**
 * A finger-prick value typed by hand (plan §5). Owners and carers only, and never a simpleMode
 * session: the role and the mode are judged here, before the body is read and before any write.
 * The log line carries the ids, a code and the time taken, never the value.
 */
export const POST = spaceRoute("spaces.readings.add", async (request, spaceId) => {
  const started = Date.now();
  const { db, now } = liveDeps();
  const { session } = await requireSpaceRole(request, spaceId, ["owner", "carer"], db, now);
  if (session.simpleMode) throw new HttpError(400, "simple-mode");
  const body = await parseBody(request, ManualReadingBody);
  const reading = await addManualReading(spaceId, body, readingDeps());
  log.info("readings.manual", {
    route: "spaces.readings.add",
    spaceId,
    userId: session.userId,
    code: "ok",
    ms: Date.now() - started,
  });
  return json(reading);
});

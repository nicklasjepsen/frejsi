import { json, log, requireSpaceRole, spaceRoute } from "@/lib/live/server";

import { dateParam, dayDeps, loadDay } from "./load-day";

const ROUTE = "spaces.day";

/**
 * `GET day?date=YYYY-MM-DD`: the space's local day as `DayView`, today by default (plan §7). Every
 * member may read it, a viewer included: it carries meals and carbs and nothing of glucose, no
 * `bolusTs` and no note. Meals the pump record made and nobody has ticked are pump data: only an
 * owner or carer outside simpleMode gets them (v0.7.0 plan §6). Logs the space, the user and a
 * count only.
 */
export const GET = spaceRoute(ROUTE, async (request, spaceId) => {
  const deps = dayDeps();
  const { session, role } = await requireSpaceRole(request, spaceId, [], deps.db, deps.now);
  const date = dateParam(request);
  const view = await loadDay(spaceId, date, session.locale, deps, {
    pumpMeals: role !== "viewer" && !session.simpleMode,
  });
  log.info("day.read", { route: ROUTE, spaceId, userId: session.userId, count: view.mealCount });
  return json(view);
});

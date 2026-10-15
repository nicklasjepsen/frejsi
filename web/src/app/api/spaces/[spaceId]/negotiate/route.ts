import { groupsFor, NegotiateResult } from "@/lib/live/contracts";
import { json, liveDeps, log, requireSpaceRole, spaceRoute } from "@/lib/live/server";

const ROUTE = "spaces.negotiate";

/**
 * A Web PubSub client token for the caller's membership in the space (plan §5). The groups are
 * baked into the token and auto-joined: `space-<id>` for every member, `space-<id>-glucose` only
 * for owners and carers, so a viewer's socket physically cannot receive a reading. 503 when no
 * live transport is configured; the client then polls `events?since`.
 */
export const GET = spaceRoute(ROUTE, async (request, spaceId) => {
  const { db, issuer } = liveDeps();
  const { session, role } = await requireSpaceRole(request, spaceId, [], db);
  const groups = groupsFor(spaceId, role);
  const token = await issuer.issueClientToken({ userId: session.userId, groups });
  if (!token) {
    log.info("live.unavailable", { route: ROUTE, spaceId, userId: session.userId, code: 503 });
    return json(
      { error: { code: "internal", message: "Live updates are not configured on this server." } },
      { status: 503 },
    );
  }
  log.info("live.negotiated", {
    route: ROUTE,
    spaceId,
    userId: session.userId,
    count: groups.length,
  });
  return json(NegotiateResult.parse({ url: token.url }));
});

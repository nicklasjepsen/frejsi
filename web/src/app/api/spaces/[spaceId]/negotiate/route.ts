import { NegotiateResult, SPACE_QUERY } from "@/lib/live/contracts";
import { json, liveDeps, log, requireSpaceRole, spaceRoute } from "@/lib/live/server";

const ROUTE = "spaces.negotiate";

/**
 * A Web PubSub client token for a member of the space (plan §5). The token carries the user id and
 * nothing else; the socket URL names the space in `?spaceId=`. When the socket connects, the hub
 * calls `/api/pubsub`, which looks up the member's role at that moment and joins the socket to
 * `space-<id>` and, for owners and carers only, `space-<id>-glucose` (issue #95). A token issued
 * before a downgrade therefore grants nothing by itself. 503 when no live transport is configured;
 * the client then polls `events?since`.
 */
export const GET = spaceRoute(ROUTE, async (request, spaceId) => {
  const { db, issuer, now } = liveDeps();
  const { session } = await requireSpaceRole(request, spaceId, [], db, now);
  const token = await issuer.issueClientToken({ userId: session.userId });
  if (!token) {
    log.info("live.unavailable", { route: ROUTE, spaceId, userId: session.userId, code: 503 });
    return json(
      { error: { code: "internal", message: "Live updates are not configured on this server." } },
      { status: 503 },
    );
  }
  log.info("live.negotiated", { route: ROUTE, spaceId, userId: session.userId });
  return json(NegotiateResult.parse({ url: withSpace(token.url, spaceId) }));
});

/** The socket URL with the space appended to its query; the access token stays as it was. */
function withSpace(url: string, spaceId: string): string {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}${SPACE_QUERY}=${encodeURIComponent(spaceId)}`;
}

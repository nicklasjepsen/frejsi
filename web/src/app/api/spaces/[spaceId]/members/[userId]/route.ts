import {
  createEventSinkFromEnv,
  groupFor,
  log,
  prisma,
  type LiveGroupRevoker,
} from "@frejsi/shared";

import { noContent, parseBody } from "@/app/api/auth/http";
import { ChangeRoleBody } from "@/components/people/contract";
import { requireMutation, spaceRoute } from "@/components/people/space-route";
import { revokeInvite } from "@/lib/auth/invites";
import { changeMemberRole, removeMember } from "@/lib/auth/members";

const ROUTE = "spaces/members/user";

let live: LiveGroupRevoker | undefined;

/**
 * Takes the member's open sockets out of the groups they may no longer hear, after the change has
 * committed (issue #79). A failed removal is tried once more; if it still fails it is logged with
 * ids only and the change stands. The socket then keeps the group until it disconnects; on
 * reconnect `negotiate` issues a token for the new role.
 */
async function leaveGroups(spaceId: string, userId: string, groups: string[]): Promise<void> {
  const transport = (live ??= createEventSinkFromEnv());
  const leave = (group: string) =>
    transport
      .removeUserFromGroup(group, userId)
      .catch(() => transport.removeUserFromGroup(group, userId));
  const results = await Promise.allSettled(groups.map(leave));
  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed > 0) {
    log.error("people.live-revoke-failed", {
      route: ROUTE,
      spaceId,
      userId,
      code: "live-revoke-failed",
      count: failed,
    });
  }
}

/**
 * An owner changes a member's role (spec §2). `changeMemberRole` emits `member.updated` in the
 * same transaction and refuses to demote the last owner (`last-owner`, 409).
 */
export const PATCH = spaceRoute<{ spaceId: string; userId: string }>(
  ROUTE,
  async (request, { spaceId, userId }) => {
    const { session } = await requireMutation(request, spaceId, "owner");
    const { role } = await parseBody(request, ChangeRoleBody);
    await changeMemberRole({ spaceId, userId, role });
    if (role === "viewer") await leaveGroups(spaceId, userId, [groupFor(spaceId, "reading")]);
    log.info("people.role-changed", { route: ROUTE, spaceId, userId: session.userId });
    return noContent();
  },
);

/**
 * An owner removes a member (spec §2). `removeMember` emits `member.removed`; the removed
 * member's next request for the space is 404 because `requireRole` finds no membership. The
 * last owner cannot be removed (`last-owner`). Their open add-a-device links are withdrawn after,
 * each with `invite.revoked`, so the list does not offer to resend a link nobody can use.
 */
export const DELETE = spaceRoute<{ spaceId: string; userId: string }>(
  ROUTE,
  async (request, { spaceId, userId }) => {
    const { session } = await requireMutation(request, spaceId, "owner");
    await removeMember({ spaceId, userId });
    await leaveGroups(spaceId, userId, [
      groupFor(spaceId, "reading"),
      groupFor(spaceId, "member.removed"),
    ]);
    const deviceLinks = await prisma.invite.findMany({
      where: {
        spaceId,
        forUserId: userId,
        usedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    for (const invite of deviceLinks) await revokeInvite(invite.token);
    log.info("people.member-removed", {
      route: ROUTE,
      spaceId,
      userId: session.userId,
      linksWithdrawn: deviceLinks.length,
    });
    return noContent();
  },
);

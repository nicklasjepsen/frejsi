import { log, prisma } from "@frejsi/shared";

import { noContent, parseBody } from "@/app/api/auth/http";
import { ChangeRoleBody } from "@/components/people/contract";
import { requireMutation, spaceRoute } from "@/components/people/space-route";
import { revokeInvite } from "@/lib/auth/invites";
import { changeMemberRole, removeMember } from "@/lib/auth/members";

const ROUTE = "spaces/members/user";

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

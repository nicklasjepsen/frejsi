import { log, Role } from "@frejsi/shared";

import { json } from "@/app/api/auth/http";
import { CreatedInviteView } from "@/components/people/contract";
import { requireMutation, spaceRoute } from "@/components/people/space-route";
import { run } from "@/lib/auth/core";
import { createInvite, hashToken, revokeInvite } from "@/lib/auth/invites";

import { findPendingInvite } from "../find";

const ROUTE = "spaces/invites/resend";

/**
 * "Send igen": the old token is revoked and a new one issued for the same person, role and (for
 * an add-a-device link) member, in one transaction, so `invite.revoked` and `invite.created`
 * either both happen or neither. The new link comes back once, to the owner (spec §2b).
 */
export const POST = spaceRoute<{ spaceId: string; inviteId: string }>(
  ROUTE,
  async (request, { spaceId, inviteId }) => {
    const { session } = await requireMutation(request, spaceId, "owner");
    const old = await findPendingInvite(spaceId, inviteId);
    const role = Role.parse(old.role);

    const created = await run({}, async (tx, emit, now) => {
      const txDeps = { db: tx, emit, now };
      await revokeInvite(old.token, txDeps);
      return createInvite(
        {
          spaceId,
          role,
          name: old.name,
          ...(old.forUserId ? { forUserId: old.forUserId } : {}),
          createdBy: session.userId,
        },
        txDeps,
      );
    });

    log.info("people.invite-resent", { route: ROUTE, spaceId, userId: session.userId });
    return json(
      CreatedInviteView.parse({
        id: hashToken(created.token),
        url: created.url,
        name: old.name,
        role,
        ...(old.forUserId ? { forUserId: old.forUserId } : {}),
        expiresAt: created.expiresAt.toISOString(),
      }),
    );
  },
);

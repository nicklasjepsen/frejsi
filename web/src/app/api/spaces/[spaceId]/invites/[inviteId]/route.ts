import { log } from "@frejsi/shared";

import { noContent } from "@/app/api/auth/http";
import { requireMutation, spaceRoute } from "@/components/people/space-route";
import { revokeInvite } from "@/lib/auth/invites";

import { findPendingInvite } from "./find";

const ROUTE = "spaces/invites/invite";

/** An owner withdraws a pending invitation; `invite.revoked` is emitted (spec §2b). */
export const DELETE = spaceRoute<{ spaceId: string; inviteId: string }>(
  ROUTE,
  async (request, { spaceId, inviteId }) => {
    const { session } = await requireMutation(request, spaceId, "owner");
    const invite = await findPendingInvite(spaceId, inviteId);
    await revokeInvite(invite.token);
    log.info("people.invite-revoked", { route: ROUTE, spaceId, userId: session.userId });
    return noContent();
  },
);

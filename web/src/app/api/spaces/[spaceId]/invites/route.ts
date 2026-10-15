import { HttpError, log, prisma, Role } from "@frejsi/shared";

import { json, parseBody } from "@/app/api/auth/http";
import { CreateInviteBody, CreatedInviteView } from "@/components/people/contract";
import { requireMutation, spaceRoute } from "@/components/people/space-route";
import { createInvite, hashToken, type NewInvite } from "@/lib/auth/invites";

const ROUTE = "spaces/invites";

/**
 * An owner invites a person (`name`, `role`) or makes an add-a-device link for a member
 * (`forUserId`): seven days, single use, `invite.created` emitted (spec §2b). The link comes
 * back once, to the owner; the list names the invite by the token's hash from then on. A carer
 * or viewer gets 403 before the body is read.
 */
export const POST = spaceRoute(ROUTE, async (request, { spaceId }) => {
  const { session } = await requireMutation(request, spaceId, "owner");
  const body = await parseBody(request, CreateInviteBody);

  let input: NewInvite;
  if ("forUserId" in body) {
    // The link adds a passkey to this member; it carries their current name and role.
    const membership = await prisma.membership.findUnique({
      where: { userId_spaceId: { userId: body.forUserId, spaceId } },
      include: { user: true },
    });
    if (!membership) throw new HttpError(404, "not-found");
    input = {
      spaceId,
      role: Role.parse(membership.role),
      name: membership.user.name,
      forUserId: body.forUserId,
      createdBy: session.userId,
    };
  } else {
    input = { spaceId, role: body.role, name: body.name, createdBy: session.userId };
  }

  const created = await createInvite(input);
  log.info("people.invite-created", { route: ROUTE, spaceId, userId: session.userId });
  return json(
    CreatedInviteView.parse({
      id: hashToken(created.token),
      url: created.url,
      name: input.name,
      role: input.role,
      ...(input.forUserId ? { forUserId: input.forUserId } : {}),
      expiresAt: created.expiresAt.toISOString(),
    }),
  );
});

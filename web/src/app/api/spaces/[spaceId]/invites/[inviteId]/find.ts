import { HttpError, prisma, type PrismaClient } from "@frejsi/shared";

import { hashToken } from "@/lib/auth/invites";

export interface PendingInviteRow {
  token: string;
  spaceId: string;
  role: string;
  name: string;
  forUserId: string | null;
}

/**
 * The unused, unrevoked invite of `spaceId` whose token hashes to `inviteId`, or 404. The hash
 * is the id the list and the events carry, so the token itself is never in a URL after the
 * owner received it. A space has a handful of open invites at most; hashing them is cheap.
 */
export async function findPendingInvite(
  spaceId: string,
  inviteId: string,
  db: Pick<PrismaClient, "invite"> = prisma,
): Promise<PendingInviteRow> {
  const open: PendingInviteRow[] = await db.invite.findMany({
    where: { spaceId, usedAt: null, revokedAt: null },
  });
  const hit = open.find((row) => hashToken(row.token) === inviteId);
  if (!hit) throw new HttpError(404, "not-found");
  return hit;
}

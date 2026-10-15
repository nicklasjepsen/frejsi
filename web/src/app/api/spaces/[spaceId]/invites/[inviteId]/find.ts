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
 * The unused, unrevoked, unexpired invite of `spaceId` whose token hashes to `inviteId`, or 404:
 * the same invites the People list shows. The hash is the id the list and the events carry, so
 * the token itself is never in a URL after the owner received it. Expired rows are left out, so
 * only a space's open invites, a handful at most, are fetched and hashed.
 */
export async function findPendingInvite(
  spaceId: string,
  inviteId: string,
  db: Pick<PrismaClient, "invite"> = prisma,
  now: Date = new Date(),
): Promise<PendingInviteRow> {
  const open: PendingInviteRow[] = await db.invite.findMany({
    where: { spaceId, usedAt: null, revokedAt: null, expiresAt: { gt: now } },
  });
  const hit = open.find((row) => hashToken(row.token) === inviteId);
  if (!hit) throw new HttpError(404, "not-found");
  return hit;
}

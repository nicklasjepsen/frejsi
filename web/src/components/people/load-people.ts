// Server side of People: the one query behind `GET /api/spaces/:id/members` and the page. The
// writes live in `@/lib/auth/{members,invites,webauthn}` (plan task 5); this module only reads.
import { prisma, Role, type PrismaClient } from "@frejsi/shared";

import { hashToken } from "@/lib/auth/invites";

import { PeopleView, type DeviceView, type MemberView, type PendingInviteView } from "./contract";

export type PeopleDb = Pick<PrismaClient, "membership" | "invite">;

export interface PeopleDeps {
  db?: PeopleDb;
  now?: () => Date;
}

/** The row shape the membership query returns; the fake in tests builds it by hand. */
interface MembershipRow {
  userId: string;
  role: string;
  createdAt: Date;
  user: {
    name: string;
    simpleMode: boolean;
    lastSeen: Date | null;
    passkeys: { id: string; deviceName: string | null; createdAt: Date; lastUsedAt: Date | null }[];
  };
}

interface InviteRow {
  token: string;
  name: string;
  role: string;
  forUserId: string | null;
  createdAt: Date;
  expiresAt: Date;
}

const byCreatedAt = <T extends { createdAt: Date }>(a: T, b: T) =>
  a.createdAt.getTime() - b.createdAt.getTime();

function toDevice(row: MembershipRow["user"]["passkeys"][number]): DeviceView {
  return {
    id: row.id,
    name: row.deviceName,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  };
}

function toMember(row: MembershipRow): MemberView {
  return {
    userId: row.userId,
    name: row.user.name,
    role: Role.parse(row.role),
    simpleMode: row.user.simpleMode,
    lastSeen: row.user.lastSeen?.toISOString() ?? null,
    devices: [...row.user.passkeys].sort(byCreatedAt).map(toDevice),
  };
}

function toPendingInvite(row: InviteRow): PendingInviteView {
  return {
    id: hashToken(row.token),
    name: row.name,
    role: Role.parse(row.role),
    ...(row.forUserId ? { forUserId: row.forUserId } : {}),
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}

/**
 * The members of a space, oldest membership first, each with their devices, and the invitations
 * that can still be used. The invites are named by their token's hash: the token itself leaves
 * the server only to the owner who creates it. Nothing here is glucose, and nothing here is a
 * credential, so any member may read it.
 */
export async function loadPeople(spaceId: string, deps: PeopleDeps = {}): Promise<PeopleView> {
  const db = deps.db ?? prisma;
  const at = (deps.now ?? (() => new Date()))();

  // The mappers below pick fields by name, so a column this view does not know (the public key,
  // the accent) never reaches the payload whatever the row carries.
  const memberships: MembershipRow[] = await db.membership.findMany({
    where: { spaceId },
    include: { user: { include: { passkeys: true } } },
  });
  const invites: InviteRow[] = await db.invite.findMany({
    where: { spaceId, usedAt: null, revokedAt: null, expiresAt: { gt: at } },
  });

  return PeopleView.parse({
    members: [...memberships].sort(byCreatedAt).map(toMember),
    invites: [...invites].sort(byCreatedAt).map(toPendingInvite),
  });
}

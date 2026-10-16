import { prisma, Role, type PrismaClient, type SessionContext } from "@frejsi/shared";

export interface ShellSpace {
  id: string;
  name: string;
  role: Role;
  /** The IANA zone the owner gave at bootstrap; every clock in the shell is formatted in it. */
  timezone: string;
  /** The subject's name when the space has one, else the space name (header, Nu-Desktop card). */
  subjectName: string;
  /** The first owner by createdAt, for "Simpel visning · slået til af {owner}". */
  ownerName: string | null;
  aiEnabled?: boolean;
  aiProvider?: string | null;
}

export interface ShellData {
  space: ShellSpace;
  spaces: { id: string; name: string; role: Role }[];
}

/** The row shape the query below returns; the fake in tests builds it by hand. */
export interface ShellMembershipRow {
  spaceId: string;
  role: string;
  createdAt: Date;
  space: {
    id: string;
    name: string;
    timezone: string;
    aiEnabled?: boolean;
    aiProvider?: string | null;
    subjectUser: { name: string } | null;
    memberships: { user: { name: string } }[];
  };
}

export type ShellDb = Pick<PrismaClient, "membership">;

/** The remembered space when it is still one of the memberships, else the first by createdAt. */
export function pickSpace(
  rows: ShellMembershipRow[],
  chosenSpaceId: string | undefined,
): ShellMembershipRow | null {
  return rows.find((row) => row.spaceId === chosenSpaceId) ?? rows[0] ?? null;
}

/**
 * What the shell needs beyond the session: the memberships oldest first with the space names,
 * the subject and the owners. One query. Null for a user who is in no space.
 */
export async function loadShellData(
  session: SessionContext,
  chosenSpaceId: string | undefined,
  db: ShellDb = prisma,
): Promise<ShellData | null> {
  const rows: ShellMembershipRow[] = await db.membership.findMany({
    where: { userId: session.userId },
    orderBy: { createdAt: "asc" },
    select: {
      spaceId: true,
      role: true,
      createdAt: true,
      space: {
        select: {
          id: true,
          name: true,
          timezone: true,
          aiEnabled: true,
          aiProvider: true,
          subjectUser: { select: { name: true } },
          memberships: {
            where: { role: "owner" },
            orderBy: { createdAt: "asc" },
            take: 1,
            select: { user: { select: { name: true } } },
          },
        },
      },
    },
  });
  const current = pickSpace(rows, chosenSpaceId);
  if (!current) return null;
  return {
    space: {
      id: current.space.id,
      name: current.space.name,
      role: Role.parse(current.role),
      timezone: current.space.timezone,
      subjectName: current.space.subjectUser?.name ?? current.space.name,
      ownerName: current.space.memberships[0]?.user.name ?? null,
      ...(current.role !== "viewer"
        ? {
            aiEnabled: current.space.aiEnabled ?? false,
            aiProvider: current.space.aiProvider ?? null,
          }
        : {}),
    },
    spaces: rows.map((row) => ({
      id: row.space.id,
      name: row.space.name,
      role: Role.parse(row.role),
    })),
  };
}

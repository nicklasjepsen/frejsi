// What the Settings pages need beyond the shell, loaded on the server (plan task 9). The role
// decides what is read at all: a viewer's data never touches the Space row, so no unit, target
// range or source can leak into their HTML.
import {
  HttpError,
  Role,
  UserSettings,
  prisma,
  type PrismaClient,
  type PumpSettingsView,
  type SessionContext,
  type SpaceSettings,
} from "@frejsi/shared";

import {
  latestSourceStatusSince,
  toSourceView,
  toSpaceSettings,
} from "@/app/api/spaces/[spaceId]/settings/space-settings";
import {
  latestPumpStatusSince,
  toPumpSettingsView,
} from "@/app/api/spaces/[spaceId]/pump-source/pump-settings";
import type { ShellSpace } from "@/components/shell/load-shell";

import type { SourceView } from "./contracts";

export type SettingsDb = Pick<PrismaClient, "space" | "membership" | "event">;

/** A member as the Settings screens show them: name, role and the four per-person settings. */
export interface SettingsPerson extends UserSettings {
  userId: string;
  name: string;
  role: Role;
}

export interface SettingsData {
  spaceId: string;
  spaceName: string;
  subjectName: string;
  timezone: string;
  role: Role;
  /** Null for a viewer: the space section is not theirs (plan task 9, §2). */
  space: SpaceSettings | null;
  source: SourceView | null;
  /**
   * The pump record's card (v0.7.0 plan task 3). Null, or absent, for a viewer and for a
   * simpleMode session: the pump record is for owners and carers outside simpleMode only.
   */
  pump?: PumpSettingsView | null;
  me: SettingsPerson;
  /** Owners get every member oldest first; everyone else only themselves. */
  people: SettingsPerson[];
}

interface MemberRow {
  userId: string;
  role: string;
  createdAt: Date;
  user: { name: string; locale: string; simpleMode: boolean; accent: string; theme: string };
}

const toPerson = (row: MemberRow): SettingsPerson => ({
  userId: row.userId,
  name: row.user.name,
  role: Role.parse(row.role),
  ...UserSettings.parse(row.user),
});

export async function loadSettingsData(
  session: SessionContext,
  shell: ShellSpace,
  db: SettingsDb = prisma,
): Promise<SettingsData> {
  const spaceId = shell.id;
  const role = shell.role;

  const rows: MemberRow[] = await db.membership.findMany({
    where: role === "owner" ? { spaceId } : { spaceId, userId: session.userId },
    orderBy: { createdAt: "asc" },
    include: { user: true },
  });
  // `orderBy` is Prisma's; the fake in tests returns rows as seeded, so the order is made sure of here.
  const people = rows
    .slice()
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map(toPerson);
  const me = people.find((p) => p.userId === session.userId);
  if (!me) throw new HttpError(404, "not-found");

  let space: SpaceSettings | null = null;
  let source: SourceView | null = null;
  let pump: PumpSettingsView | null = null;
  if (role !== "viewer") {
    const row = await db.space.findUnique({ where: { id: spaceId } });
    if (!row) throw new HttpError(404, "not-found");
    space = toSpaceSettings(row);
    source = toSourceView(row, await latestSourceStatusSince(db, spaceId));
    if (!session.simpleMode)
      pump = toPumpSettingsView(row, await latestPumpStatusSince(db, spaceId));
  }

  return {
    spaceId,
    spaceName: shell.name,
    subjectName: shell.subjectName,
    timezone: shell.timezone,
    role,
    space,
    source,
    pump,
    me,
    people,
  };
}

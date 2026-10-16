import type { SessionContext } from "@frejsi/shared";
import { describe, expect, it } from "vitest";

import { loadShellData, pickSpace, type ShellDb, type ShellMembershipRow } from "./load-shell";

const session: SessionContext = {
  userId: "u1",
  name: "Jonas",
  simpleMode: false,
  accent: "olive",
  locale: "da",
  memberships: [
    { spaceId: "s2", role: "carer" },
    { spaceId: "s1", role: "owner" },
  ],
};

const row = (
  spaceId: string,
  role: string,
  createdAt: string,
  extra: Partial<ShellMembershipRow["space"]> = {},
): ShellMembershipRow => ({
  spaceId,
  role,
  createdAt: new Date(createdAt),
  space: {
    id: spaceId,
    name: `${spaceId} rum`,
    timezone: "Europe/Copenhagen",
    subjectUser: null,
    memberships: [{ user: { name: "Mette" } }],
    ...extra,
  },
});

function fakeDb(rows: ShellMembershipRow[]) {
  const calls: unknown[] = [];
  const db = {
    membership: {
      findMany: (args: unknown) => {
        calls.push(args);
        return Promise.resolve(rows);
      },
    },
  } as unknown as ShellDb;
  return { db, calls };
}

describe("pickSpace", () => {
  it("takes the remembered space when it is still one of the memberships, else the first", () => {
    const rows = [row("s1", "owner", "2026-01-01"), row("s2", "carer", "2026-02-01")];
    expect(pickSpace(rows, "s2")?.spaceId).toBe("s2");
    expect(pickSpace(rows, "s9")?.spaceId).toBe("s1");
    expect(pickSpace(rows, undefined)?.spaceId).toBe("s1");
    expect(pickSpace([], "s1")).toBeNull();
  });
});

describe("loadShellData", () => {
  it("asks for the user's memberships oldest first with the space, its subject and its owners", async () => {
    const { db, calls } = fakeDb([row("s1", "owner", "2026-01-01")]);
    await loadShellData(session, undefined, db);
    expect(calls[0]).toMatchObject({
      where: { userId: "u1" },
      orderBy: { createdAt: "asc" },
      select: { space: { select: { timezone: true } } },
    });
  });

  it("shows the first membership by createdAt, with the subject's name when the space has one, else the space name", async () => {
    const { db } = fakeDb([
      row("s1", "owner", "2026-01-01"),
      row("s2", "carer", "2026-02-01", { subjectUser: { name: "Alma" } }),
    ]);
    const data = await loadShellData(session, undefined, db);
    expect(data?.space).toEqual({
      id: "s1",
      name: "s1 rum",
      role: "owner",
      timezone: "Europe/Copenhagen",
      subjectName: "s1 rum",
      ownerName: "Mette",
      aiEnabled: false,
      aiProvider: null,
    });
    expect(data?.spaces).toEqual([
      { id: "s1", name: "s1 rum", role: "owner" },
      { id: "s2", name: "s2 rum", role: "carer" },
    ]);
    const chosen = await loadShellData(session, "s2", db);
    expect(chosen?.space).toMatchObject({ id: "s2", role: "carer", subjectName: "Alma" });
  });

  it("returns null for a user without memberships and no owner name for a space without one", async () => {
    expect(await loadShellData(session, undefined, fakeDb([]).db)).toBeNull();
    const { db } = fakeDb([row("s1", "viewer", "2026-01-01", { memberships: [] })]);
    expect((await loadShellData(session, undefined, db))?.space.ownerName).toBeNull();
  });

  it("rejects a role the contract does not know rather than rendering a shell for it", async () => {
    const { db } = fakeDb([row("s1", "god", "2026-01-01")]);
    await expect(loadShellData(session, undefined, db)).rejects.toThrow();
  });
});

it("loads AI navigation metadata for carers and omits it from the viewer shell", async () => {
  const enabled = row("s1", "carer", "2026-01-01", { aiEnabled: true, aiProvider: "anthropic" });
  expect((await loadShellData(session, undefined, fakeDb([enabled]).db))?.space).toMatchObject({
    aiEnabled: true,
    aiProvider: "anthropic",
  });
  const viewer = { ...enabled, role: "viewer" };
  const space = (await loadShellData(session, undefined, fakeDb([viewer]).db))?.space;
  expect(space).not.toHaveProperty("aiEnabled");
  expect(space).not.toHaveProperty("aiProvider");
});

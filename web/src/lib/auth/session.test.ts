import { HttpError, type EmitFn, type SessionContext } from "@frejsi/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  assertRole,
  getSession,
  loadSession,
  requireRole,
  SESSION_COOKIE,
  type SessionDb,
} from "./session";

const cookieJar = new Map<string, string>();

/** The rows and the `emit` the mocked @frejsi/shared serves to requireRole(). */
const shared = vi.hoisted(() => {
  const rows: Row[] = [];
  const emitted: unknown[][] = [];
  return {
    rows,
    emitted,
    prisma: {
      session: {
        findUnique: ({ where }: { where: { id: string } }) =>
          Promise.resolve(rows.find((r) => r.id === where.id) ?? null),
        update: () => Promise.resolve(null),
      },
      user: { update: () => Promise.resolve(null) },
    },
    emit: (...args: unknown[]) => {
      emitted.push(args);
      return Promise.resolve({});
    },
  };
});
vi.mock("@frejsi/shared", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  prisma: shared.prisma,
  emit: shared.emit,
}));
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => {
        const value = cookieJar.get(name);
        return value === undefined ? undefined : { name, value };
      },
    }),
}));

const T0 = new Date("2026-10-15T08:00:00.000Z");
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);

interface Row {
  id: string;
  userId: string;
  expiresAt: Date;
  lastSeenAt: Date;
  user: {
    id: string;
    name: string;
    simpleMode: boolean;
    accent: string;
    theme: string;
    locale: string;
    memberships: { spaceId: string; role: string }[];
  };
}

function caught(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected a throw");
}

function fakeDb(rows: Row[]) {
  const touches: { session: Date[]; user: Date[] } = { session: [], user: [] };
  const emitted: [string, string, unknown][] = [];
  const emit = ((spaceId: string, type: string, payload: unknown) => {
    emitted.push([spaceId, type, payload]);
    return Promise.resolve({});
  }) as EmitFn;
  const db = {
    session: {
      findUnique: ({ where }: { where: { id: string } }) =>
        Promise.resolve(rows.find((r) => r.id === where.id) ?? null),
      update: ({ where, data }: { where: { id: string }; data: { lastSeenAt: Date } }) => {
        const row = rows.find((r) => r.id === where.id);
        if (row) row.lastSeenAt = data.lastSeenAt;
        touches.session.push(data.lastSeenAt);
        return Promise.resolve(row);
      },
    },
    user: {
      update: ({ data }: { where: { id: string }; data: { lastSeen: Date } }) => {
        touches.user.push(data.lastSeen);
        return Promise.resolve(null);
      },
    },
  } as unknown as SessionDb;
  return { db, touches, emit, emitted };
}

const alive = (): Row => ({
  id: "sess-1",
  userId: "u1",
  expiresAt: new Date("2027-01-01T00:00:00.000Z"),
  lastSeenAt: T0,
  user: {
    id: "u1",
    name: "Example Person",
    simpleMode: true,
    accent: "plum",
    theme: "dark",
    locale: "en",
    memberships: [
      { spaceId: "s1", role: "carer" },
      { spaceId: "s2", role: "viewer" },
    ],
  },
});

const expected: SessionContext = {
  userId: "u1",
  name: "Example Person",
  simpleMode: true,
  accent: "plum",
  theme: "dark",
  locale: "en",
  memberships: [
    { spaceId: "s1", role: "carer" },
    { spaceId: "s2", role: "viewer" },
  ],
};

beforeEach(() => {
  cookieJar.clear();
});

describe("getSession", () => {
  it("returns the SessionContext for a valid frejsi_session cookie", async () => {
    cookieJar.set(SESSION_COOKIE, "sess-1");
    const { db, emit } = fakeDb([alive()]);
    await expect(getSession({ db, emit, now: () => minutes(1) })).resolves.toEqual(expected);
  });

  it("returns null without a cookie, for an unknown id and for an expired session", async () => {
    const { db } = fakeDb([{ ...alive(), expiresAt: minutes(-1) }]);
    await expect(getSession({ db, now: () => T0 })).resolves.toBeNull();
    cookieJar.set(SESSION_COOKIE, "sess-unknown");
    await expect(getSession({ db, now: () => T0 })).resolves.toBeNull();
    cookieJar.set(SESSION_COOKIE, "sess-1");
    await expect(getSession({ db, now: () => T0 })).resolves.toBeNull();
  });
});

describe("loadSession", () => {
  it("touches lastSeenAt and lastSeen at most once per hour", async () => {
    const { db, emit, touches } = fakeDb([alive()]);
    await loadSession("sess-1", { db, emit, now: () => minutes(10) });
    await loadSession("sess-1", { db, emit, now: () => minutes(59) });
    expect(touches.session).toEqual([]);
    expect(touches.user).toEqual([]);

    await loadSession("sess-1", { db, emit, now: () => minutes(60) });
    await loadSession("sess-1", { db, emit, now: () => minutes(90) });
    expect(touches.session).toEqual([minutes(60)]);
    expect(touches.user).toEqual([minutes(60)]);

    await loadSession("sess-1", { db, emit, now: () => minutes(125) });
    expect(touches.session).toEqual([minutes(60), minutes(125)]);
  });

  it("emits member.updated to every space of the user when lastSeen changes, and only then", async () => {
    // People shows "Sidst set", so the touch is a space-visible member write (CLAUDE.md: every
    // write emits). The session row is device bookkeeping and emits nothing.
    const { db, emit, emitted } = fakeDb([alive()]);
    await loadSession("sess-1", { db, emit, now: () => minutes(30) });
    expect(emitted).toEqual([]);

    await loadSession("sess-1", { db, emit, now: () => minutes(60) });
    expect(emitted).toEqual([
      ["s1", "member.updated", { userId: "u1" }],
      ["s2", "member.updated", { userId: "u1" }],
    ]);

    await loadSession("sess-1", { db, emit, now: () => minutes(90) });
    expect(emitted).toHaveLength(2);
  });
});

describe("assertRole and requireRole", () => {
  it("answers 404 for a non-member so space ids do not leak", () => {
    const error = caught(() => assertRole(expected, "s-other", "owner"));
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ status: 404, code: "not-found" });
  });

  it("answers 403 for an insufficient role and for no session", () => {
    expect(caught(() => assertRole(expected, "s2", "owner", "carer"))).toMatchObject({
      status: 403,
      code: "forbidden",
    });
    expect(caught(() => assertRole(null, "s1"))).toMatchObject({ status: 403, code: "forbidden" });
  });

  it("returns the membership when the role fits, any role when none is named", () => {
    expect(assertRole(expected, "s1", "owner", "carer")).toEqual({
      session: expected,
      role: "carer",
    });
    expect(assertRole(expected, "s2")).toEqual({ session: expected, role: "viewer" });
  });

  it("requireRole reads the cookie of the current request and the shared prisma client and emit", async () => {
    // lastSeenAt in the past, so this request is a touch and goes through the shared emit.
    shared.rows.splice(0, shared.rows.length, { ...alive(), lastSeenAt: new Date(0) });
    shared.emitted.splice(0, shared.emitted.length);
    cookieJar.set(SESSION_COOKIE, "sess-1");
    await expect(requireRole("s1", { now: () => T0 }, "carer")).resolves.toEqual({
      session: expected,
      role: "carer",
    });
    expect(shared.emitted.map((call) => call.slice(0, 2))).toEqual([
      ["s1", "member.updated"],
      ["s2", "member.updated"],
    ]);
    await expect(requireRole("s-other", { now: () => T0 })).rejects.toMatchObject({
      status: 404,
      code: "not-found",
    });
    await expect(requireRole("s2", { now: () => T0 }, "owner")).rejects.toMatchObject({ status: 403 });
    cookieJar.clear();
    await expect(requireRole("s1", { now: () => T0 })).rejects.toMatchObject({
      status: 403,
      code: "forbidden",
    });
  });

  it("requireRole rejects a session exactly at expiry by the caller's clock without touching it", async () => {
    const row = alive();
    const { db, emit, touches, emitted } = fakeDb([row]);
    cookieJar.set(SESSION_COOKIE, row.id);
    await expect(
      requireRole("s1", { db, emit, now: () => row.expiresAt }, "carer"),
    ).rejects.toMatchObject({ status: 403, code: "forbidden" });
    expect(touches).toEqual({ session: [], user: [] });
    expect(emitted).toEqual([]);
  });

  it("requireRole keeps the real clock and variadic roles when no dependencies are passed", async () => {
    const now = new Date();
    shared.rows.splice(0, shared.rows.length, {
      ...alive(),
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
    });
    cookieJar.set(SESSION_COOKIE, "sess-1");
    await expect(requireRole("s1", "owner", "carer")).resolves.toEqual({
      session: expected,
      role: "carer",
    });
    await expect(requireRole("s2")).resolves.toEqual({ session: expected, role: "viewer" });
    await expect(requireRole("s2", "owner", "carer")).rejects.toMatchObject({ status: 403 });
  });
});

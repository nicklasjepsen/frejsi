// @vitest-environment node
import type { EventEnvelope, EventSink, LiveGroupRevoker } from "@frejsi/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PeopleView } from "@/components/people/contract";
import {
  assertNoPii,
  createWorld,
  DEVICE_NAMES,
  PENDING_TOKEN,
  USERS,
  type World,
} from "@/components/people/route-test-support";
import { hashToken } from "@/lib/auth/invites";

import { DELETE as removeMember, PATCH as changeRole } from "./[userId]/route";
import { GET as listMembers } from "./route";

const holders = vi.hoisted(() => {
  const shared: { db: Record<string, unknown>; sink: EventSink; live: LiveGroupRevoker } = {
    db: {},
    sink: { publish: () => Promise.resolve() },
    live: {
      removeUserFromGroup: () => Promise.resolve(),
      closeUserConnections: () => Promise.resolve(),
    },
  };
  const sink: EventSink & LiveGroupRevoker = {
    publish: (group, envelope) => shared.sink.publish(group, envelope),
    removeUserFromGroup: (group, userId, options) =>
      shared.live.removeUserFromGroup(group, userId, options),
    closeUserConnections: (userId, options) => shared.live.closeUserConnections(userId, options),
  };
  return {
    shared,
    cookies: new Map<string, string>(),
    prisma: new Proxy({}, { get: (_target, key: string) => shared.db[key] }),
    sink,
  };
});
vi.mock("@frejsi/shared", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  prisma: holders.prisma,
  createEventSinkFromEnv: () => holders.sink,
}));
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => {
        const value = holders.cookies.get(name);
        return value === undefined ? undefined : { name, value };
      },
    }),
}));

/**
 * The live transport as the members' open sockets see it: each connection is auto-joined to the
 * groups its token names (as `negotiate` issues them), and a publish reaches the users in the group.
 */
function liveConnections() {
  const joined = new Map<string, Set<string>>();
  const received = new Map<string, EventEnvelope[]>();
  const removed: { group: string; userId: string }[] = [];
  const closed: string[] = [];
  let removeFailures = 0;
  let closeFailures = 0;
  let hang = false;
  /** A call the service never answers; it only ends when the caller's signal aborts it. */
  const hanging = (signal?: AbortSignal) =>
    new Promise<void>((_resolve, reject) => {
      signal?.addEventListener(
        "abort",
        () => {
          reject(new Error("aborted"));
        },
        { once: true },
      );
    });
  return {
    removed,
    closed,
    connect(userId: string, groups: string[]) {
      joined.set(userId, new Set(groups));
      received.set(userId, []);
    },
    publish(group: string, envelope: EventEnvelope) {
      for (const [userId, groups] of joined) {
        if (groups.has(group)) received.get(userId)?.push(envelope);
      }
    },
    received: (userId: string) => received.get(userId) ?? [],
    groupsOf: (userId: string) => [...(joined.get(userId) ?? [])],
    failRevokes(times = Number.POSITIVE_INFINITY) {
      removeFailures = times;
    },
    failCloses() {
      closeFailures = Number.POSITIVE_INFINITY;
    },
    hangRevokes() {
      hang = true;
    },
    revoker: {
      removeUserFromGroup(group: string, userId: string, options?: { signal?: AbortSignal }) {
        if (hang) return hanging(options?.signal);
        if (removeFailures > 0) {
          removeFailures -= 1;
          return Promise.reject(new Error("service unavailable"));
        }
        removed.push({ group, userId });
        joined.get(userId)?.delete(group);
        return Promise.resolve();
      },
      closeUserConnections(userId: string) {
        if (closeFailures > 0) return Promise.reject(new Error("service unavailable"));
        closed.push(userId);
        joined.delete(userId);
        return Promise.resolve();
      },
    } satisfies LiveGroupRevoker,
  };
}

const reading: EventEnvelope = {
  spaceId: "s1",
  seq: 99,
  ts: "2026-10-15T08:05:00.000Z",
  type: "reading",
  payload: { ts: "2026-10-15T08:05:00.000Z", mmol: 6.4, trend: "flat" },
};

let world: World;
let live: ReturnType<typeof liveConnections>;
beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-10-15T08:00:00.000Z"), toFake: ["Date"] });
  process.env.APP_ORIGIN = "https://frejsi.example";
  world = createWorld(holders);
  live = liveConnections();
  holders.shared.live = live.revoker;
  live.connect(USERS.owner.id, ["space-s1", "space-s1-glucose"]);
  live.connect(USERS.secondOwner.id, ["space-s1", "space-s1-glucose"]);
  live.connect(USERS.carer.id, ["space-s1", "space-s1-glucose"]);
  live.connect(USERS.viewer.id, ["space-s1"]);
});
afterEach(() => {
  world.reset();
  vi.useRealTimers();
  delete process.env.APP_ORIGIN;
});

const params = <P>(p: P) => ({ params: Promise.resolve(p) });
const list = () =>
  listMembers(world.request("GET", "/api/spaces/s1/members"), params({ spaceId: "s1" }));

describe("GET /api/spaces/:id/members", () => {
  it("gives every member, a viewer included, the members with their devices and the pending invites", async () => {
    world.as("viewer");
    const res = await list();
    expect(res.status).toBe(200);
    const view = (await res.json()) as PeopleView;
    expect(view.members.map((m) => [m.userId, m.role])).toEqual([
      [USERS.owner.id, "owner"],
      [USERS.secondOwner.id, "owner"],
      [USERS.carer.id, "carer"],
      [USERS.viewer.id, "viewer"],
    ]);
    expect(view.members[0]?.devices.map((d) => d.name)).toEqual([DEVICE_NAMES.ownerPhone, null]);
    expect(view.invites).toEqual([
      expect.objectContaining({ id: hashToken(PENDING_TOKEN), name: "Example Invitee" }),
    ]);
    expect(world.events).toEqual([]);
  });

  it("carries no glucose field: the payload's keys are the contract's and nothing more (hard rule)", async () => {
    world.as("carer");
    const text = await (await list()).text();
    const keys = [...text.matchAll(/"([A-Za-z]+)":/g)].map((m) => m[1]);
    expect(new Set(keys)).toEqual(
      new Set([
        "members",
        "userId",
        "name",
        "role",
        "simpleMode",
        "lastSeen",
        "devices",
        "id",
        "createdAt",
        "lastUsedAt",
        "invites",
        "expiresAt",
      ]),
    );
    expect(text).not.toMatch(/mmol|mgdl|glucose|reading|trend|publicKey|credential/i);
    expect(text).not.toContain(PENDING_TOKEN);
  });

  it("answers 404 for a non-member and 403 without a session, so space ids do not leak", async () => {
    world.as("outsider");
    expect((await list()).status).toBe(404);
    world.as(null);
    const res = await list();
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "forbidden" } });
  });

  it("logs ids and the count only", async () => {
    world.as("owner");
    await list();
    expect(world.logLines.length).toBeGreaterThan(0);
    assertNoPii(world.log());
    expect(world.log()).toContain('"spaceId":"s1"');
    expect(world.log()).toContain(`"userId":"${USERS.owner.id}"`);
  });
});

describe("PATCH /api/spaces/:id/members/:userId", () => {
  const patch = (userId: string, body: unknown, headers?: Record<string, string>) =>
    changeRole(
      world.request("PATCH", `/api/spaces/s1/members/${userId}`, body, headers),
      params({ spaceId: "s1", userId }),
    );

  it("lets an owner change a member's role and emits member.updated", async () => {
    world.as("owner");
    const res = await patch(USERS.carer.id, { role: "viewer" });
    expect(res.status).toBe(204);
    expect(
      world.fake.rows("membership").find((m) => m.userId === USERS.carer.id && m.spaceId === "s1"),
    ).toMatchObject({ role: "viewer" });
    expect(world.events).toEqual([
      {
        spaceId: "s1",
        type: "member.updated",
        payload: { userId: USERS.carer.id, role: "viewer" },
      },
    ]);
  });

  it("refuses to demote the last owner with 409 last-owner, and writes nothing", async () => {
    world.as("owner");
    expect((await patch(USERS.secondOwner.id, { role: "carer" })).status).toBe(204);
    const res = await patch(USERS.owner.id, { role: "carer" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "last-owner" } });
    expect(
      world.fake.rows("membership").find((m) => m.userId === USERS.owner.id && m.spaceId === "s1"),
    ).toMatchObject({ role: "owner" });
    expect(world.events.map((e) => e.type)).toEqual(["member.updated"]);
  });

  it("takes a carer downgraded to viewer out of the glucose group at once: no later reading reaches them", async () => {
    world.as("owner");
    expect((await patch(USERS.carer.id, { role: "viewer" })).status).toBe(204);
    expect(live.removed).toEqual([{ group: "space-s1-glucose", userId: USERS.carer.id }]);
    live.publish("space-s1-glucose", reading);
    expect(live.received(USERS.carer.id)).toEqual([]);
    expect(live.received(USERS.owner.id)).toEqual([reading]);
    expect(live.groupsOf(USERS.carer.id)).toEqual(["space-s1"]);
  });

  it("does the same for an owner downgraded to viewer", async () => {
    world.as("owner");
    expect((await patch(USERS.secondOwner.id, { role: "viewer" })).status).toBe(204);
    live.publish("space-s1-glucose", reading);
    expect(live.received(USERS.secondOwner.id)).toEqual([]);
  });

  it("revokes nothing on a change that keeps glucose (carer to owner, owner to carer) or is refused", async () => {
    world.as("owner");
    expect((await patch(USERS.secondOwner.id, { role: "carer" })).status).toBe(204);
    expect((await patch(USERS.owner.id, { role: "viewer" })).status).toBe(409);
    expect((await patch(USERS.carer.id, { role: "owner" })).status).toBe(204);
    expect(live.removed).toEqual([]);
  });

  it("tries a failed revoke once more before giving up", async () => {
    live.failRevokes(1);
    world.as("owner");
    expect((await patch(USERS.carer.id, { role: "viewer" })).status).toBe(204);
    live.publish("space-s1-glucose", reading);
    expect(live.received(USERS.carer.id)).toEqual([]);
    expect(world.log()).not.toContain("live-revoke-failed");
  });

  it("drops the member's sockets when the group removal keeps failing, so they renegotiate", async () => {
    live.failRevokes();
    world.as("owner");
    expect((await patch(USERS.carer.id, { role: "viewer" })).status).toBe(204);
    expect(live.closed).toEqual([USERS.carer.id]);
    live.publish("space-s1-glucose", reading);
    expect(live.received(USERS.carer.id)).toEqual([]);
    expect(live.received(USERS.owner.id)).toEqual([reading]);
    expect(world.log()).toContain('"code":"live-revoke-closed"');
    expect(world.log()).not.toContain("live-revoke-failed");
    assertNoPii(world.log());
  });

  it("does not hold the owner's request on a service that does not answer", async () => {
    vi.useRealTimers();
    vi.useFakeTimers({
      now: new Date("2026-10-15T08:00:00.000Z"),
      toFake: ["Date", "setTimeout", "clearTimeout"],
    });
    live.hangRevokes();
    world.as("owner");
    let settled: Response | undefined;
    void patch(USERS.carer.id, { role: "viewer" }).then((r) => (settled = r));
    for (let ms = 0; ms < 10_000 && !settled; ms += 500) await vi.advanceTimersByTimeAsync(500);
    expect(settled?.status).toBe(204);
    expect(live.closed).toEqual([USERS.carer.id]);
    live.publish("space-s1-glucose", reading);
    expect(live.received(USERS.carer.id)).toEqual([]);
  });

  it("keeps the committed role when the revoke fails, and logs ids only", async () => {
    live.failRevokes();
    live.failCloses();
    world.as("owner");
    expect((await patch(USERS.carer.id, { role: "viewer" })).status).toBe(204);
    expect(
      world.fake.rows("membership").find((m) => m.userId === USERS.carer.id && m.spaceId === "s1"),
    ).toMatchObject({ role: "viewer" });
    expect(world.log()).toContain('"code":"live-revoke-failed"');
    expect(world.log()).not.toContain("service unavailable");
    assertNoPii(world.log());
  });

  it("gives a carer and a viewer 403, in the API, before the body is read", async () => {
    for (const who of ["carer", "viewer"] as const) {
      world.as(who);
      const res = await patch(USERS.viewer.id, "not even json");
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ error: { code: "forbidden" } });
    }
    expect(world.events).toEqual([]);
  });

  it("answers 400 for an unknown role, 404 for a non-member and 403 for a foreign origin", async () => {
    world.as("owner");
    expect((await patch(USERS.carer.id, { role: "admin" })).status).toBe(400);
    expect((await patch("u-nobody", { role: "carer" })).status).toBe(404);
    expect(
      (await patch(USERS.carer.id, { role: "viewer" }, { origin: "https://evil.example" })).status,
    ).toBe(403);
    expect(world.events).toEqual([]);
  });
});

describe("DELETE /api/spaces/:id/members/:userId", () => {
  const remove = (userId: string) =>
    removeMember(
      world.request("DELETE", `/api/spaces/s1/members/${userId}`),
      params({ spaceId: "s1", userId }),
    );

  it("lets an owner remove a member, emits member.removed, and the member's next request is 404", async () => {
    world.as("owner");
    const res = await remove(USERS.carer.id);
    expect(res.status).toBe(204);
    expect(world.events).toEqual([
      { spaceId: "s1", type: "member.removed", payload: { userId: USERS.carer.id } },
    ]);
    world.as("carer");
    const next = await list();
    expect(next.status).toBe(404);
    expect(await next.json()).toMatchObject({ error: { code: "not-found" } });
  });

  it("takes the removed member out of the space group and the glucose group at once", async () => {
    world.as("owner");
    expect((await remove(USERS.carer.id)).status).toBe(204);
    expect(live.removed).toEqual(
      expect.arrayContaining([
        { group: "space-s1-glucose", userId: USERS.carer.id },
        { group: "space-s1", userId: USERS.carer.id },
      ]),
    );
    live.publish("space-s1-glucose", reading);
    live.publish("space-s1", { ...reading, type: "member.removed", payload: { userId: "x" } });
    expect(live.received(USERS.carer.id)).toEqual([]);
    expect(live.groupsOf(USERS.carer.id)).toEqual([]);
  });

  it("keeps the removal when the revoke fails, and logs ids only", async () => {
    live.failRevokes();
    live.failCloses();
    world.as("owner");
    expect((await remove(USERS.carer.id)).status).toBe(204);
    expect(
      world.fake.rows("membership").find((m) => m.userId === USERS.carer.id && m.spaceId === "s1"),
    ).toBeUndefined();
    expect(world.log()).toContain('"code":"live-revoke-failed"');
    assertNoPii(world.log());
  });

  it("revokes nothing when the removal is refused", async () => {
    world.as("carer");
    expect((await remove(USERS.viewer.id)).status).toBe(403);
    world.as("owner");
    expect((await remove("u-nobody")).status).toBe(404);
    expect(live.removed).toEqual([]);
  });

  it("withdraws the removed member's pending add-a-device links, emitting invite.revoked", async () => {
    world.fake.rows("invite").push({
      token: "carer-device-token",
      spaceId: "s1",
      role: "carer",
      name: USERS.carer.name,
      forUserId: USERS.carer.id,
      createdBy: USERS.owner.id,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      usedAt: null,
      revokedAt: null,
    });
    world.as("owner");
    expect((await remove(USERS.carer.id)).status).toBe(204);
    expect(world.fake.rows("invite").find((i) => i.token === "carer-device-token")).toMatchObject({
      revokedAt: expect.any(Date) as Date,
    });
    expect(world.events).toEqual([
      { spaceId: "s1", type: "member.removed", payload: { userId: USERS.carer.id } },
      {
        spaceId: "s1",
        type: "invite.revoked",
        payload: {
          tokenHash: hashToken("carer-device-token"),
          role: "carer",
          name: USERS.carer.name,
          forUserId: USERS.carer.id,
        },
      },
    ]);
    // The ordinary pending invitation is someone else's and stays.
    world.as("owner");
    const view = (await (await list()).json()) as PeopleView;
    expect(view.invites.map((i) => i.id)).toEqual([hashToken(PENDING_TOKEN)]);
  });

  it("refuses to remove the last owner with last-owner, but lets one of two owners go", async () => {
    world.as("owner");
    expect((await remove(USERS.secondOwner.id)).status).toBe(204);
    const res = await remove(USERS.owner.id);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "last-owner" } });
    expect(world.events.map((e) => e.type)).toEqual(["member.removed"]);
  });

  it("gives a carer or viewer 403 and leaves the memberships alone", async () => {
    world.as("carer");
    expect((await remove(USERS.viewer.id)).status).toBe(403);
    world.as("viewer");
    expect((await remove(USERS.carer.id)).status).toBe(403);
    expect(world.fake.rows("membership").filter((m) => m.spaceId === "s1")).toHaveLength(4);
    expect(world.events).toEqual([]);
  });

  it("logs ids only: no member name reaches a log line", async () => {
    world.as("owner");
    await changeRole(
      world.request("PATCH", `/api/spaces/s1/members/${USERS.carer.id}`, { role: "owner" }),
      params({ spaceId: "s1", userId: USERS.carer.id }),
    );
    await remove(USERS.viewer.id);
    await remove("u-nobody");
    expect(world.logLines.length).toBeGreaterThanOrEqual(3);
    assertNoPii(world.log());
  });
});

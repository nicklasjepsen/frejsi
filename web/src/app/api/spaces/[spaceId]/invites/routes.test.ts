// @vitest-environment node
import type { EventSink } from "@frejsi/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CreatedInviteView } from "@/components/people/contract";
import {
  assertNoPii,
  createWorld,
  days,
  ORIGIN,
  PENDING_NAME,
  PENDING_TOKEN,
  USERS,
  type World,
} from "@/components/people/route-test-support";
import { hashToken } from "@/lib/auth/invites";

import { POST as resend } from "./[inviteId]/resend/route";
import { DELETE as revoke } from "./[inviteId]/route";
import { POST as create } from "./route";

const holders = vi.hoisted(() => {
  const shared: { db: Record<string, unknown>; sink: EventSink } = {
    db: {},
    sink: { publish: () => Promise.resolve() },
  };
  const sink: EventSink = { publish: (group, envelope) => shared.sink.publish(group, envelope) };
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

let world: World;
beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-10-15T08:00:00.000Z"), toFake: ["Date"] });
  process.env.APP_ORIGIN = ORIGIN;
  world = createWorld(holders);
});
afterEach(() => {
  world.reset();
  vi.useRealTimers();
  delete process.env.APP_ORIGIN;
});

const params = <P>(p: P) => ({ params: Promise.resolve(p) });
const post = (body: unknown, headers?: Record<string, string>) =>
  create(world.request("POST", "/api/spaces/s1/invites", body, headers), params({ spaceId: "s1" }));
const TOKEN = /\/invite\/([A-Za-z0-9_-]{43})$/;
const pendingId = hashToken(PENDING_TOKEN);

describe("POST /api/spaces/:id/invites", () => {
  it("lets an owner invite a person: a link good for 7 days, single use, and invite.created", async () => {
    world.as("owner");
    const res = await post({ name: "New Example Person", role: "carer" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as CreatedInviteView;
    expect(body.url).toMatch(new RegExp(`^${ORIGIN}/invite/`));
    const token = TOKEN.exec(body.url)?.[1] ?? "";
    expect(body).toEqual({
      id: hashToken(token),
      url: `${ORIGIN}/invite/${token}`,
      name: "New Example Person",
      role: "carer",
      expiresAt: days(7).toISOString(),
    });
    expect(world.fake.rows("invite").find((i) => i.token === token)).toMatchObject({
      spaceId: "s1",
      role: "carer",
      name: "New Example Person",
      forUserId: null,
      createdBy: USERS.owner.id,
      expiresAt: days(7),
      usedAt: null,
    });
    expect(world.events).toEqual([
      {
        spaceId: "s1",
        type: "invite.created",
        payload: { tokenHash: hashToken(token), role: "carer", name: "New Example Person" },
      },
    ]);
  });

  it("lets an owner make an add-a-device link for any member (forUserId), with their name and role", async () => {
    world.as("owner");
    const res = await post({ forUserId: USERS.carer.id });
    expect(res.status).toBe(200);
    const body = (await res.json()) as CreatedInviteView;
    const token = TOKEN.exec(body.url)?.[1] ?? "";
    expect(body).toEqual({
      id: hashToken(token),
      url: `${ORIGIN}/invite/${token}`,
      name: USERS.carer.name,
      role: "carer",
      forUserId: USERS.carer.id,
      expiresAt: days(7).toISOString(),
    });
    expect(world.fake.rows("invite").find((i) => i.token === token)).toMatchObject({
      forUserId: USERS.carer.id,
      createdBy: USERS.owner.id,
    });
    expect(world.events).toEqual([
      {
        spaceId: "s1",
        type: "invite.created",
        payload: {
          tokenHash: hashToken(token),
          role: "carer",
          name: USERS.carer.name,
          forUserId: USERS.carer.id,
        },
      },
    ]);
    // Not for someone outside the space.
    expect((await post({ forUserId: USERS.outsider.id })).status).toBe(404);
  });

  it("gives a carer and a viewer 403 in the API, before the body is read", async () => {
    for (const who of ["carer", "viewer"] as const) {
      world.as(who);
      const res = await post("not json");
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ error: { code: "forbidden" } });
    }
    world.as("outsider");
    expect((await post({ name: "X", role: "carer" })).status).toBe(404);
    expect(world.fake.rows("invite")).toHaveLength(1);
    expect(world.events).toEqual([]);
  });

  it("answers 400 validation for a blank name or an unknown role, and 403 for a foreign origin", async () => {
    world.as("owner");
    expect((await post({ name: "   ", role: "carer" })).status).toBe(400);
    expect((await post({ name: "Fine", role: "admin" })).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect(
      (await post({ name: "Fine", role: "carer" }, { origin: "https://evil.example" })).status,
    ).toBe(403);
    expect(world.events).toEqual([]);
  });
});

describe("POST /api/spaces/:id/invites/:inviteId/resend", () => {
  const send = (inviteId: string) =>
    resend(
      world.request("POST", `/api/spaces/s1/invites/${inviteId}/resend`),
      params({ spaceId: "s1", inviteId }),
    );

  it("revokes the old token and issues a new one for the same person and role, emitting both events", async () => {
    world.as("owner");
    const res = await send(pendingId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as CreatedInviteView;
    const token = TOKEN.exec(body.url)?.[1] ?? "";
    expect(token).not.toBe(PENDING_TOKEN);
    expect(body).toMatchObject({
      id: hashToken(token),
      name: PENDING_NAME,
      role: "carer",
      expiresAt: days(7).toISOString(),
    });
    expect(world.fake.rows("invite").find((i) => i.token === PENDING_TOKEN)).toMatchObject({
      revokedAt: new Date("2026-10-15T08:00:00.000Z"),
    });
    expect(world.events).toEqual([
      {
        spaceId: "s1",
        type: "invite.revoked",
        payload: { tokenHash: pendingId, role: "carer", name: PENDING_NAME },
      },
      {
        spaceId: "s1",
        type: "invite.created",
        payload: { tokenHash: hashToken(token), role: "carer", name: PENDING_NAME },
      },
    ]);
    // The old id is gone; the new one can be sent again.
    expect((await send(pendingId)).status).toBe(404);
    expect((await send(hashToken(token))).status).toBe(200);
  });

  it("gives a carer 403 and answers 404 for an unknown id or another space's invite", async () => {
    world.as("carer");
    expect((await send(pendingId)).status).toBe(403);
    world.as("owner");
    expect((await send("not-an-id")).status).toBe(404);
    world.fake.rows("invite").push({
      token: "other-space-token",
      spaceId: "s2",
      role: "carer",
      name: "Other",
      forUserId: null,
      createdBy: USERS.outsider.id,
      createdAt: days(0),
      expiresAt: days(7),
      usedAt: null,
      revokedAt: null,
    });
    expect((await send(hashToken("other-space-token"))).status).toBe(404);
    expect(world.events).toEqual([]);
  });
});

describe("DELETE /api/spaces/:id/invites/:inviteId", () => {
  const del = (inviteId: string) =>
    revoke(
      world.request("DELETE", `/api/spaces/s1/invites/${inviteId}`),
      params({ spaceId: "s1", inviteId }),
    );

  it("lets an owner withdraw a pending invitation and emits invite.revoked", async () => {
    world.as("owner");
    expect((await del(pendingId)).status).toBe(204);
    expect(world.events).toEqual([
      {
        spaceId: "s1",
        type: "invite.revoked",
        payload: { tokenHash: pendingId, role: "carer", name: PENDING_NAME },
      },
    ]);
    expect((await del(pendingId)).status).toBe(404);
  });

  it("gives a viewer 403", async () => {
    world.as("viewer");
    expect((await del(pendingId)).status).toBe(403);
    expect(world.events).toEqual([]);
  });
});

describe("the invite routes' log", () => {
  it("never carries a name, a token or a link", async () => {
    world.as("owner");
    const created = (await (await post({ name: "New Example Person", role: "viewer" })).json()) as {
      url: string;
    };
    await post({ forUserId: USERS.carer.id });
    await resend(
      world.request("POST", `/api/spaces/s1/invites/${pendingId}/resend`),
      params({ spaceId: "s1", inviteId: pendingId }),
    );
    world.as("carer");
    await post({ name: "Nope", role: "carer" });
    const all = world.log();
    expect(world.logLines.length).toBeGreaterThanOrEqual(4);
    assertNoPii(all);
    expect(all).not.toContain("New Example Person");
    expect(all).not.toContain(created.url);
    for (const row of world.fake.rows("invite")) expect(all).not.toContain(row.token as string);
    expect(all).toContain(`"userId":"${USERS.owner.id}"`);
  });
});

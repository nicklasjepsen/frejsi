// @vitest-environment node
import type { EventSink } from "@frejsi/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  assertNoPii,
  createWorld,
  ORIGIN,
  PASSKEYS,
  USERS,
  type World,
} from "@/components/people/route-test-support";
import { loadSession } from "@/lib/auth/session";

import { DELETE as removeDevice } from "./[passkeyId]/route";

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

const del = (passkeyId: string, headers?: Record<string, string>) =>
  removeDevice(
    world.request("DELETE", `/api/spaces/s1/passkeys/${passkeyId}`, undefined, headers),
    {
      params: Promise.resolve({ spaceId: "s1", passkeyId }),
    },
  );

describe("DELETE /api/spaces/:id/passkeys/:passkeyId", () => {
  it("lets an owner remove any member's device: the passkey and its sessions go, device.removed is emitted", async () => {
    // The carer's tablet has an open session of its own.
    world.fake.rows("session").push({
      id: "sess-carer-tablet",
      userId: USERS.carer.id,
      passkeyId: PASSKEYS.carerTablet,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 1000_000),
      lastSeenAt: new Date(),
    });
    world.as("owner");
    const res = await del(PASSKEYS.carerTablet);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ signedOut: false });
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(world.fake.rows("passkey").map((p) => p.id)).not.toContain(PASSKEYS.carerTablet);
    expect(world.fake.rows("session").map((s) => s.id)).not.toContain("sess-carer-tablet");
    await expect(loadSession("sess-carer-tablet", { db: world.fake.db })).resolves.toBeNull();
    expect(world.events).toEqual([
      {
        spaceId: "s1",
        type: "device.removed",
        payload: { userId: USERS.carer.id, passkeyId: PASSKEYS.carerTablet },
      },
    ]);
  });

  it("lets an owner remove one of their own devices too", async () => {
    world.as("owner");
    const res = await del(PASSKEYS.ownerLaptop);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ signedOut: false });
    expect(world.events.map((e) => e.type)).toEqual(["device.removed"]);
  });

  it("says so when the removed device is the one making the request, and clears its cookie", async () => {
    const own = world.fake.rows("session").find((s) => s.id === USERS.owner.session);
    if (!own) throw new Error("seeded owner session missing");
    own.passkeyId = PASSKEYS.ownerPhone;
    world.as("owner");
    const res = await del(PASSKEYS.ownerPhone);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ signedOut: true });
    expect(res.headers.get("set-cookie")).toMatch(/frejsi_session=;.*Max-Age=0/i);
    await expect(loadSession(USERS.owner.session, { db: world.fake.db })).resolves.toBeNull();
    expect(world.events.map((e) => e.type)).toEqual(["device.removed"]);
  });

  it("gives a carer and a viewer 403, even for their own device, and writes nothing", async () => {
    world.as("carer");
    expect((await del(PASSKEYS.carerTablet)).status).toBe(403);
    world.as("viewer");
    expect((await del(PASSKEYS.ownerPhone)).status).toBe(403);
    expect(world.fake.rows("passkey")).toHaveLength(4);
    expect(world.events).toEqual([]);
  });

  it("answers 404 for an unknown passkey and for one belonging to someone outside the space", async () => {
    world.as("owner");
    expect((await del("pk-nobody")).status).toBe(404);
    const res = await del(PASSKEYS.outsiderPhone);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: "not-found" } });
    expect(world.fake.rows("passkey").map((p) => p.id)).toContain(PASSKEYS.outsiderPhone);
    expect(world.events).toEqual([]);
  });

  it("refuses a foreign origin", async () => {
    world.as("owner");
    expect((await del(PASSKEYS.carerTablet, { origin: "https://evil.example" })).status).toBe(403);
    expect(world.events).toEqual([]);
  });

  it("logs ids only: no device name or member name", async () => {
    world.as("owner");
    await del(PASSKEYS.carerTablet);
    await del("pk-nobody");
    expect(world.logLines.length).toBeGreaterThanOrEqual(2);
    assertNoPii(world.log());
    expect(world.log()).toContain(`"userId":"${USERS.owner.id}"`);
  });
});

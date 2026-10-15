// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createInvite,
  hashToken,
  INVITE_TTL_MS,
  inviteUrl,
  loadInvite,
  markInviteUsed,
  newInviteToken,
  revokeInvite,
} from "./invites";
import { FakeAuthDb, recordingEmit } from "./test-support";

const T0 = new Date("2026-10-15T08:00:00.000Z");
const days = (n: number) => new Date(T0.getTime() + n * 24 * 60 * 60 * 1000);

function seeded() {
  const fake = new FakeAuthDb(() => T0);
  fake.rows("space").push({ id: "s1", name: "Example space", timezone: "Europe/Copenhagen" });
  fake.rows("user").push({ id: "owner", name: "Example Owner" });
  fake.rows("user").push({ id: "u2", name: "Example Carer" });
  return fake;
}

beforeEach(() => {
  process.env.APP_ORIGIN = "https://frejsi.example";
});
afterEach(() => {
  delete process.env.APP_ORIGIN;
});

describe("invite tokens", () => {
  it("are 32 random bytes as base64url, and only their hash travels in events", () => {
    const token = newInviteToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newInviteToken()).not.toBe(token);
    expect(hashToken(token)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashToken(token)).not.toContain(token);
    expect(hashToken(token)).toBe(hashToken(token));
  });

  it("build the landing URL from APP_ORIGIN without a locale; the middleware routes it", () => {
    expect(inviteUrl("abc")).toBe("https://frejsi.example/invite/abc");
  });
});

describe("createInvite", () => {
  it("stores a single-use token valid 7 days and emits invite.created with the hash", async () => {
    const fake = seeded();
    const { emit, events } = recordingEmit();
    const invite = await createInvite(
      { spaceId: "s1", role: "carer", name: "Example Carer", createdBy: "owner" },
      { db: fake.db, emit, now: () => T0 },
    );
    expect(invite.expiresAt).toEqual(days(7));
    expect(INVITE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(fake.rows("invite")).toEqual([
      {
        token: invite.token,
        spaceId: "s1",
        role: "carer",
        name: "Example Carer",
        forUserId: null,
        createdBy: "owner",
        createdAt: T0,
        expiresAt: days(7),
        usedAt: null,
        revokedAt: null,
      },
    ]);
    expect(events).toEqual([
      {
        spaceId: "s1",
        type: "invite.created",
        payload: { tokenHash: hashToken(invite.token), role: "carer", name: "Example Carer" },
      },
    ]);
    expect(JSON.stringify(events)).not.toContain(invite.token);
  });

  it("carries forUserId for an add-a-device link", async () => {
    const fake = seeded();
    const { emit, events } = recordingEmit();
    await createInvite(
      { spaceId: "s1", role: "carer", name: "Example Carer", forUserId: "u2", createdBy: "owner" },
      { db: fake.db, emit, now: () => T0 },
    );
    expect(fake.rows("invite")[0]).toMatchObject({ forUserId: "u2" });
    expect(events[0]?.payload).toMatchObject({ forUserId: "u2" });
  });
});

describe("loadInvite", () => {
  async function withInvite(overrides: Record<string, unknown> = {}) {
    const fake = seeded();
    const { emit } = recordingEmit();
    const { token } = await createInvite(
      { spaceId: "s1", role: "viewer", name: "Example Viewer", createdBy: "owner" },
      { db: fake.db, emit, now: () => T0 },
    );
    Object.assign(fake.rows("invite")[0] ?? {}, overrides);
    return { fake, token };
  }

  it("returns the row with its space and creator while it is valid", async () => {
    const { fake, token } = await withInvite();
    const invite = await loadInvite(token, { db: fake.db, now: () => days(6) });
    expect(invite).toMatchObject({
      token,
      role: "viewer",
      name: "Example Viewer",
      space: { id: "s1", name: "Example space" },
      creator: { id: "owner", name: "Example Owner" },
    });
  });

  it("answers invite-expired after 7 days", async () => {
    const { fake, token } = await withInvite();
    await expect(loadInvite(token, { db: fake.db, now: () => days(7) })).rejects.toMatchObject({
      status: 410,
      code: "invite-expired",
    });
  });

  it("answers invite-used, invite-revoked and not-found", async () => {
    const used = await withInvite({ usedAt: T0 });
    await expect(loadInvite(used.token, { db: used.fake.db, now: () => T0 })).rejects.toMatchObject(
      { status: 410, code: "invite-used" },
    );
    const revoked = await withInvite({ revokedAt: T0 });
    await expect(
      loadInvite(revoked.token, { db: revoked.fake.db, now: () => T0 }),
    ).rejects.toMatchObject({ status: 410, code: "invite-revoked" });
    const { fake } = await withInvite();
    await expect(loadInvite("unknown", { db: fake.db, now: () => T0 })).rejects.toMatchObject({
      status: 404,
      code: "not-found",
    });
  });
});

describe("markInviteUsed", () => {
  it("marks the token used once; the second attempt is invite-used", async () => {
    const fake = seeded();
    const { emit } = recordingEmit();
    const { token } = await createInvite(
      { spaceId: "s1", role: "viewer", name: "Example Viewer", createdBy: "owner" },
      { db: fake.db, emit, now: () => T0 },
    );
    await markInviteUsed(token, { db: fake.db, now: () => days(1) });
    expect(fake.rows("invite")[0]).toMatchObject({ usedAt: days(1) });
    await expect(markInviteUsed(token, { db: fake.db, now: () => days(1) })).rejects.toMatchObject({
      code: "invite-used",
    });
  });

  it("names the real cause when the claim fails: revoked, expired or gone, not always invite-used", async () => {
    const fake = seeded();
    const { emit } = recordingEmit();
    const deps = { db: fake.db, emit, now: () => T0 };
    const make = () =>
      createInvite({ spaceId: "s1", role: "viewer", name: "Example Viewer", createdBy: "owner" }, deps);

    // Revoked between the landing page's check and the claim at the end of the ceremony.
    const revoked = await make();
    await revokeInvite(revoked.token, deps);
    await expect(markInviteUsed(revoked.token, deps)).rejects.toMatchObject({
      status: 410,
      code: "invite-revoked",
    });

    const expired = await make();
    await expect(
      markInviteUsed(expired.token, { ...deps, now: () => days(8) }),
    ).rejects.toMatchObject({ status: 410, code: "invite-expired" });
    expect(fake.rows("invite").find((i) => i.token === expired.token)).toMatchObject({
      usedAt: null,
    });

    await expect(markInviteUsed("no-such-token", deps)).rejects.toMatchObject({
      status: 404,
      code: "not-found",
    });
  });
});

describe("revokeInvite", () => {
  it("sets revokedAt and emits invite.revoked; a used or revoked token is left alone", async () => {
    const fake = seeded();
    const { emit, events } = recordingEmit();
    const { token } = await createInvite(
      { spaceId: "s1", role: "viewer", name: "Example Viewer", createdBy: "owner" },
      { db: fake.db, emit, now: () => T0 },
    );
    await revokeInvite(token, { db: fake.db, emit, now: () => days(1) });
    expect(fake.rows("invite")[0]).toMatchObject({ revokedAt: days(1) });
    expect(events.map((e) => e.type)).toEqual(["invite.created", "invite.revoked"]);
    expect(events[1]?.payload).toEqual({
      tokenHash: hashToken(token),
      role: "viewer",
      name: "Example Viewer",
    });

    await expect(
      revokeInvite(token, { db: fake.db, emit, now: () => days(2) }),
    ).rejects.toMatchObject({ code: "invite-revoked" });
    expect(events).toHaveLength(2);
  });
});

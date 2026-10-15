// @vitest-environment node
import { describe, expect, it } from "vitest";

import { hashToken } from "@/lib/auth/invites";
import { FakeAuthDb } from "@/lib/auth/test-support";

import { PeopleView } from "./contract";
import { loadPeople } from "./load-people";

const T0 = new Date("2026-10-15T08:00:00.000Z");
const days = (n: number) => new Date(T0.getTime() + n * 24 * 60 * 60 * 1000);

function seed() {
  const fake = new FakeAuthDb(() => T0);
  fake.rows("space").push({ id: "s1", name: "Example space", timezone: "Europe/Copenhagen" });
  fake.rows("space").push({ id: "s2", name: "Other space", timezone: "Europe/Copenhagen" });
  fake
    .rows("user")
    .push(
      { id: "u-owner", name: "Example Owner", simpleMode: false, lastSeen: T0 },
      { id: "u-child", name: "Example Child", simpleMode: true, lastSeen: days(-1) },
      { id: "u-viewer", name: "Example Viewer", simpleMode: false, lastSeen: null },
      { id: "u-elsewhere", name: "Someone Else", simpleMode: false, lastSeen: T0 },
    );
  fake
    .rows("membership")
    .push(
      { userId: "u-child", spaceId: "s1", role: "carer", createdAt: days(-2) },
      { userId: "u-owner", spaceId: "s1", role: "owner", createdAt: days(-3) },
      { userId: "u-viewer", spaceId: "s1", role: "viewer", createdAt: days(-1) },
      { userId: "u-elsewhere", spaceId: "s2", role: "owner", createdAt: days(-3) },
    );
  fake.rows("passkey").push(
    {
      id: "pk-1",
      userId: "u-owner",
      credentialId: "c1",
      publicKey: new Uint8Array([1]),
      counter: 3,
      deviceName: "Example phone",
      createdAt: days(-3),
      lastUsedAt: T0,
    },
    {
      id: "pk-2",
      userId: "u-owner",
      credentialId: "c2",
      publicKey: new Uint8Array([2]),
      counter: 0,
      deviceName: null,
      createdAt: days(-1),
      lastUsedAt: null,
    },
    {
      id: "pk-3",
      userId: "u-child",
      credentialId: "c3",
      publicKey: new Uint8Array([3]),
      counter: 1,
      deviceName: "Example tablet",
      createdAt: days(-2),
      lastUsedAt: days(-1),
    },
  );
  fake.rows("invite").push(
    {
      token: "pending-token",
      spaceId: "s1",
      role: "carer",
      name: "Example Invitee",
      forUserId: null,
      createdBy: "u-owner",
      createdAt: days(-1),
      expiresAt: days(6),
      usedAt: null,
      revokedAt: null,
    },
    {
      token: "device-token",
      spaceId: "s1",
      role: "carer",
      name: "Example Child",
      forUserId: "u-child",
      createdBy: "u-owner",
      createdAt: T0,
      expiresAt: days(7),
      usedAt: null,
      revokedAt: null,
    },
    {
      token: "used-token",
      spaceId: "s1",
      role: "viewer",
      name: "Used One",
      forUserId: null,
      createdBy: "u-owner",
      createdAt: days(-5),
      expiresAt: days(2),
      usedAt: days(-4),
      revokedAt: null,
    },
    {
      token: "revoked-token",
      spaceId: "s1",
      role: "viewer",
      name: "Revoked One",
      forUserId: null,
      createdBy: "u-owner",
      createdAt: days(-5),
      expiresAt: days(2),
      usedAt: null,
      revokedAt: days(-4),
    },
    {
      token: "expired-token",
      spaceId: "s1",
      role: "viewer",
      name: "Expired One",
      forUserId: null,
      createdBy: "u-owner",
      createdAt: days(-9),
      expiresAt: days(-2),
      usedAt: null,
      revokedAt: null,
    },
    {
      token: "other-space-token",
      spaceId: "s2",
      role: "carer",
      name: "Other Invitee",
      forUserId: null,
      createdBy: "u-elsewhere",
      createdAt: T0,
      expiresAt: days(7),
      usedAt: null,
      revokedAt: null,
    },
  );
  return fake;
}

describe("loadPeople (plan task 7)", () => {
  it("lists the space's members oldest first with their devices, and nothing from another space", async () => {
    const fake = seed();
    const view = await loadPeople("s1", { db: fake.db, now: () => T0 });
    expect(PeopleView.parse(view)).toEqual(view);
    expect(view.members.map((m) => m.userId)).toEqual(["u-owner", "u-child", "u-viewer"]);
    expect(view.members[0]).toEqual({
      userId: "u-owner",
      name: "Example Owner",
      role: "owner",
      simpleMode: false,
      lastSeen: T0.toISOString(),
      devices: [
        {
          id: "pk-1",
          name: "Example phone",
          createdAt: days(-3).toISOString(),
          lastUsedAt: T0.toISOString(),
        },
        { id: "pk-2", name: null, createdAt: days(-1).toISOString(), lastUsedAt: null },
      ],
    });
    expect(view.members[1]).toMatchObject({ role: "carer", simpleMode: true });
    expect(view.members[2]).toMatchObject({ role: "viewer", lastSeen: null, devices: [] });
  });

  it("lists only the invites that can still be used, named by the token's hash and never the token", async () => {
    const fake = seed();
    const view = await loadPeople("s1", { db: fake.db, now: () => T0 });
    expect(view.invites).toEqual([
      {
        id: hashToken("pending-token"),
        name: "Example Invitee",
        role: "carer",
        createdAt: days(-1).toISOString(),
        expiresAt: days(6).toISOString(),
      },
      {
        id: hashToken("device-token"),
        name: "Example Child",
        role: "carer",
        forUserId: "u-child",
        createdAt: T0.toISOString(),
        expiresAt: days(7).toISOString(),
      },
    ]);
    expect(JSON.stringify(view)).not.toContain("pending-token");
    expect(JSON.stringify(view)).not.toContain("device-token");
  });

  it("leaves out an add-a-device link for someone who is no longer a member", async () => {
    const fake = seed();
    fake.rows("invite").push({
      token: "orphan-device-token",
      spaceId: "s1",
      role: "carer",
      name: "Someone Else",
      forUserId: "u-elsewhere",
      createdBy: "u-owner",
      createdAt: T0,
      expiresAt: days(7),
      usedAt: null,
      revokedAt: null,
    });
    const view = await loadPeople("s1", { db: fake.db, now: () => T0 });
    expect(view.invites.map((i) => i.id)).not.toContain(hashToken("orphan-device-token"));
    expect(view.invites).toHaveLength(2);
  });

  it("carries no glucose and no credential: only the keys the contract names (hard rule)", async () => {
    const fake = seed();
    const view = await loadPeople("s1", { db: fake.db, now: () => T0 });
    const keys = new Set<string>();
    const walk = (value: unknown) => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (typeof value === "object" && value !== null) {
        for (const [k, v] of Object.entries(value)) {
          keys.add(k);
          walk(v);
        }
      }
    };
    walk(view);
    expect([...keys].sort()).toEqual(
      [
        "createdAt",
        "devices",
        "expiresAt",
        "forUserId",
        "id",
        "invites",
        "lastSeen",
        "lastUsedAt",
        "members",
        "name",
        "role",
        "simpleMode",
        "userId",
      ].sort(),
    );
    const text = JSON.stringify(view).toLowerCase();
    for (const word of ["mmol", "mgdl", "glucose", "reading", "trend", "publickey", "credential"]) {
      expect(text, word).not.toContain(word);
    }
  });

  it("returns empty lists for a space without members", async () => {
    const fake = seed();
    await expect(loadPeople("s-none", { db: fake.db, now: () => T0 })).resolves.toEqual({
      members: [],
      invites: [],
    });
  });
});

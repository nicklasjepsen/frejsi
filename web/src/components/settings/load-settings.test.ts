// @vitest-environment node
import type { SessionContext } from "@frejsi/shared";
import { describe, expect, it } from "vitest";

import type { ShellSpace } from "@/components/shell/load-shell";
import { FakeAuthDb } from "@/lib/auth/test-support";

import { loadSettingsData, type SettingsDb } from "./load-settings";

const T0 = new Date("2026-10-15T08:00:00.000Z");

const shell: ShellSpace = {
  id: "s1",
  name: "Example space",
  role: "owner",
  timezone: "Europe/Copenhagen",
  subjectName: "Example Subject",
  ownerName: "Example Owner",
};

const session = (userId: string, role: "owner" | "carer" | "viewer"): SessionContext => ({
  userId,
  name: "whoever",
  simpleMode: false,
  accent: "olive",
  theme: "system",
  locale: "da",
  memberships: [{ spaceId: "s1", role }],
});

function setup() {
  const fake = new FakeAuthDb(() => T0);
  fake.rows("space").push({
    id: "s1",
    name: "Example space",
    timezone: "Europe/Copenhagen",
    glucoseUnit: "mgdl",
    targetLow: 3.9,
    targetHigh: 10,
    glucoseSource: JSON.stringify({ type: "dexcom-share", region: "eu", secretRef: "glucose-s1" }),
    sourceStatus: "disconnected",
    sourceFailures: 3,
    lastReadingAt: new Date("2026-10-15T06:13:00.000Z"),
    lastSeq: 2,
  });
  const person = { createdAt: T0 };
  fake.rows("user").push({ id: "u-owner", name: "Example Owner", simpleMode: false, accent: "olive", theme: "system", locale: "da", ...person });
  fake.rows("user").push({ id: "u-child", name: "Example Subject", simpleMode: true, accent: "plum", theme: "system", locale: "da", ...person });
  fake.rows("user").push({ id: "u-viewer", name: "Example Viewer", simpleMode: false, accent: "sea", theme: "system", locale: "en", ...person });
  const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
  fake.rows("membership").push({ userId: "u-child", spaceId: "s1", role: "carer", createdAt: at(1) });
  fake.rows("membership").push({ userId: "u-owner", spaceId: "s1", role: "owner", createdAt: at(0) });
  fake.rows("membership").push({ userId: "u-viewer", spaceId: "s1", role: "viewer", createdAt: at(2) });
  // Two status events: the loader must take the latest, whatever order the rows come back in.
  fake.rows("event").push({
    spaceId: "s1",
    seq: 2,
    type: "source.status",
    payload: JSON.stringify({ status: "disconnected", since: "2026-10-15T07:30:00.000Z" }),
    ts: T0,
  });
  fake.rows("event").push({
    spaceId: "s1",
    seq: 1,
    type: "source.status",
    payload: JSON.stringify({ status: "connected", since: "2026-10-14T07:00:00.000Z" }),
    ts: T0,
  });
  fake.rows("event").push({ spaceId: "s2", seq: 9, type: "source.status", payload: "{}", ts: T0 });
  return { fake, db: fake.db as unknown as SettingsDb };
}

describe("loadSettingsData (plan task 9)", () => {
  it("gives an owner the space settings, the source with the time it went down, and every member oldest first", async () => {
    const { db } = setup();
    const data = await loadSettingsData(session("u-owner", "owner"), shell, db);
    expect(data.role).toBe("owner");
    expect(data.space).toEqual({
      aiEnabled: false,
      name: "Example space",
      timezone: "Europe/Copenhagen",
      glucoseUnit: "mgdl",
      targetLow: 3.9,
      targetHigh: 10,
      sourceType: "dexcom-share",
      sourceStatus: "disconnected",
      lastReadingAt: "2026-10-15T06:13:00.000Z",
    });
    expect(data.source).toEqual({
      type: "dexcom-share",
      region: "eu",
      status: "disconnected",
      lastReadingAt: "2026-10-15T06:13:00.000Z",
      since: "2026-10-15T07:30:00.000Z",
    });
    expect(data.people.map((p) => [p.userId, p.role, p.simpleMode, p.accent, p.locale])).toEqual([
      ["u-owner", "owner", false, "olive", "da"],
      ["u-child", "carer", true, "plum", "da"],
      ["u-viewer", "viewer", false, "sea", "en"],
    ]);
    expect(data.me).toEqual({
      userId: "u-owner",
      name: "Example Owner",
      role: "owner",
      simpleMode: false,
      accent: "olive",
      theme: "system",
      locale: "da",
    });
    expect(JSON.stringify(data)).not.toContain("glucose-s1");
  });

  it("gives a carer the space section but only themselves as a person", async () => {
    const { db } = setup();
    const data = await loadSettingsData(session("u-child", "carer"), { ...shell, role: "carer" }, db);
    expect(data.space?.glucoseUnit).toBe("mgdl");
    expect(data.source?.type).toBe("dexcom-share");
    expect(data.people.map((p) => p.userId)).toEqual(["u-child"]);
    expect(data.me.simpleMode).toBe(true);
  });

  it("gives a viewer no space section at all: no unit, no target range, no source", async () => {
    const { fake, db } = setup();
    const data = await loadSettingsData(session("u-viewer", "viewer"), { ...shell, role: "viewer" }, db);
    expect(data.space).toBeNull();
    expect(data.source).toBeNull();
    expect(data.people.map((p) => p.userId)).toEqual(["u-viewer"]);
    expect(JSON.stringify(data)).not.toMatch(/mgdl|targetLow|dexcom/);
    // The space row was not even read for a viewer.
    expect(fake.operations.filter((op) => op.table === "space")).toEqual([]);
  });

  it("has a null since when no status event exists yet", async () => {
    const { fake, db } = setup();
    fake.tables.event = [];
    const data = await loadSettingsData(session("u-owner", "owner"), shell, db);
    expect(data.source?.since).toBeNull();
  });
});

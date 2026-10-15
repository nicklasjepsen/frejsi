// @vitest-environment node
import { describe, expect, it } from "vitest";

import { FakeAuthDb, recordingSink } from "@/lib/auth/test-support";

import { updateUserSettings } from "./user-settings";

const T0 = new Date("2026-10-15T08:00:00.000Z");

function setup() {
  const fake = new FakeAuthDb(() => T0);
  const { sink, events } = recordingSink();
  fake.rows("space").push({ id: "s1", name: "Example space", timezone: "Europe/Copenhagen" });
  fake.rows("space").push({ id: "s2", name: "Other space", timezone: "Europe/Copenhagen" });
  fake.rows("user").push({ id: "u1", name: "Example Person", simpleMode: false, accent: "olive", locale: "da" });
  fake.rows("membership").push({ userId: "u1", spaceId: "s1", role: "carer", createdAt: T0 });
  fake.rows("membership").push({ userId: "u1", spaceId: "s2", role: "viewer", createdAt: T0 });
  return { fake, sink, events, deps: { db: fake.db, sink, now: () => T0 } };
}

describe("updateUserSettings", () => {
  it("writes the given fields only and returns the user's settings", async () => {
    const { fake, deps } = setup();
    const result = await updateUserSettings("u1", { accent: "plum" }, deps);
    expect(result).toEqual({ locale: "da", simpleMode: false, accent: "plum" });
    expect(fake.rows("user")[0]).toMatchObject({ accent: "plum", locale: "da", simpleMode: false });
  });

  it("emits member.updated { userId } to every space the user belongs to, in the same transaction", async () => {
    const { fake, events, deps } = setup();
    await updateUserSettings("u1", { simpleMode: true, locale: "en" }, deps);
    expect(events).toEqual([
      { spaceId: "s1", type: "member.updated", payload: { userId: "u1" } },
      { spaceId: "s2", type: "member.updated", payload: { userId: "u1" } },
    ]);
    expect(fake.rows("event").map((e) => e.spaceId)).toEqual(["s1", "s2"]);
    expect(fake.operations.filter((op) => op.op === "update")).toEqual([
      { table: "user", op: "update", inTransaction: true },
      { table: "space", op: "update", inTransaction: true },
      { table: "space", op: "update", inTransaction: true },
    ]);
  });

  it("answers 404 not-found for an unknown user and writes nothing", async () => {
    const { fake, events, deps } = setup();
    await expect(updateUserSettings("nobody", { accent: "sea" }, deps)).rejects.toMatchObject({
      status: 404,
      code: "not-found",
    });
    expect(events).toEqual([]);
    expect(fake.rows("event")).toEqual([]);
  });
});

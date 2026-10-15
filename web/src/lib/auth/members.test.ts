// @vitest-environment node
import { describe, expect, it } from "vitest";

import { addMember, changeMemberRole, removeMember } from "./members";
import { FakeAuthDb, FakeDbError, recordingSink } from "./test-support";

const T0 = new Date("2026-10-15T08:00:00.000Z");

function seeded() {
  const fake = new FakeAuthDb(() => T0);
  fake.rows("space").push({ id: "s1", name: "Example space", timezone: "Europe/Copenhagen" });
  fake.rows("user").push({ id: "o1", name: "Example Owner" });
  fake.rows("user").push({ id: "o2", name: "Second Owner" });
  fake.rows("user").push({ id: "c1", name: "Example Carer" });
  fake.rows("membership").push({ userId: "o1", spaceId: "s1", role: "owner", createdAt: T0 });
  fake.rows("membership").push({ userId: "c1", spaceId: "s1", role: "carer", createdAt: T0 });
  const { sink, events } = recordingSink();
  return { fake, sink, events };
}

describe("addMember", () => {
  it("creates the membership and emits member.joined with the role", async () => {
    const { fake, sink, events } = seeded();
    await addMember({ spaceId: "s1", userId: "o2", role: "owner" }, { db: fake.db, sink });
    expect(fake.rows("membership")).toContainEqual({
      userId: "o2",
      spaceId: "s1",
      role: "owner",
      createdAt: T0,
    });
    expect(events).toEqual([
      { spaceId: "s1", type: "member.joined", payload: { userId: "o2", role: "owner" } },
    ]);
  });
});

describe("changeMemberRole", () => {
  it("updates the role and emits member.updated with the new role", async () => {
    const { fake, sink, events } = seeded();
    await changeMemberRole({ spaceId: "s1", userId: "c1", role: "viewer" }, { db: fake.db, sink });
    expect(fake.rows("membership").find((m) => m.userId === "c1")).toMatchObject({
      role: "viewer",
    });
    expect(events).toEqual([
      { spaceId: "s1", type: "member.updated", payload: { userId: "c1", role: "viewer" } },
    ]);
  });

  it("refuses to demote the last owner (last-owner) and writes nothing", async () => {
    const { fake, sink, events } = seeded();
    await expect(
      changeMemberRole({ spaceId: "s1", userId: "o1", role: "carer" }, { db: fake.db, sink }),
    ).rejects.toMatchObject({ status: 409, code: "last-owner" });
    expect(fake.rows("membership").find((m) => m.userId === "o1")).toMatchObject({ role: "owner" });
    expect(events).toEqual([]);
  });

  it("lets an owner step down once another owner exists", async () => {
    const { fake, sink } = seeded();
    await addMember({ spaceId: "s1", userId: "o2", role: "owner" }, { db: fake.db, sink });
    await changeMemberRole({ spaceId: "s1", userId: "o1", role: "carer" }, { db: fake.db, sink });
    expect(fake.rows("membership").find((m) => m.userId === "o1")).toMatchObject({ role: "carer" });
  });

  it("runs the owner count and the write in one serializable transaction, so two owners cannot both step down", async () => {
    const { fake, sink } = seeded();
    await addMember({ spaceId: "s1", userId: "o2", role: "owner" }, { db: fake.db, sink });
    fake.operations.length = 0;
    fake.transactions.length = 0;
    await changeMemberRole({ spaceId: "s1", userId: "o1", role: "carer" }, { db: fake.db, sink });
    await expect(
      removeMember({ spaceId: "s1", userId: "o2" }, { db: fake.db, sink }),
    ).rejects.toMatchObject({ code: "last-owner" });
    expect(fake.transactions).toEqual([
      { isolationLevel: "Serializable" },
      { isolationLevel: "Serializable" },
    ]);
    // Every read and write, the owner count and the event row included, went through the
    // transaction client; the membership calls in their order:
    expect(fake.operations.every((o) => o.inTransaction)).toBe(true);
    expect(fake.operations.filter((o) => o.table === "membership")).toEqual([
      { table: "membership", op: "findUnique", inTransaction: true },
      { table: "membership", op: "count", inTransaction: true },
      { table: "membership", op: "update", inTransaction: true },
      { table: "membership", op: "findUnique", inTransaction: true },
      { table: "membership", op: "count", inTransaction: true },
    ]);
  });

  it("still answers last-owner when SQL Server kills the transaction as a deadlock victim (P2034)", async () => {
    const { fake, sink, events } = seeded();
    // Two owners step down in the same second; this request loses the deadlock and is retried.
    let victim = true;
    fake.onTransaction = () => {
      if (!victim) return;
      victim = false;
      throw new FakeDbError("P2034", "Transaction failed due to a write conflict or a deadlock.");
    };
    await expect(
      changeMemberRole({ spaceId: "s1", userId: "o1", role: "carer" }, { db: fake.db, sink }),
    ).rejects.toMatchObject({ status: 409, code: "last-owner" });
    expect(fake.transactions).toHaveLength(2);
    expect(fake.rows("membership").find((m) => m.userId === "o1")).toMatchObject({ role: "owner" });
    expect(events).toEqual([]);
  });

  it("answers not-found for someone who is not a member", async () => {
    const { fake, sink } = seeded();
    await expect(
      changeMemberRole({ spaceId: "s1", userId: "o2", role: "carer" }, { db: fake.db, sink }),
    ).rejects.toMatchObject({ status: 404, code: "not-found" });
  });
});

describe("removeMember", () => {
  it("deletes the membership and emits member.removed", async () => {
    const { fake, sink, events } = seeded();
    await removeMember({ spaceId: "s1", userId: "c1" }, { db: fake.db, sink });
    expect(fake.rows("membership").map((m) => m.userId)).toEqual(["o1"]);
    expect(events).toEqual([{ spaceId: "s1", type: "member.removed", payload: { userId: "c1" } }]);
  });

  it("refuses to remove the last owner", async () => {
    const { fake, sink, events } = seeded();
    await expect(
      removeMember({ spaceId: "s1", userId: "o1" }, { db: fake.db, sink }),
    ).rejects.toMatchObject({ status: 409, code: "last-owner" });
    expect(fake.rows("membership")).toHaveLength(2);
    expect(events).toEqual([]);
  });
});

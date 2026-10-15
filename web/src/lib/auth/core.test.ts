// @vitest-environment node
import { createLogger, HttpError } from "@frejsi/shared";
import { describe, expect, it } from "vitest";

import { transact, TRANSACTION_ATTEMPTS } from "./core";
import { FakeAuthDb, FakeDbError, recordingEmit } from "./test-support";

function seeded() {
  const fake = new FakeAuthDb();
  fake.rows("space").push({ id: "s1", name: "Example space", timezone: "Europe/Copenhagen" });
  fake.rows("user").push({ id: "u1", name: "Example Owner" });
  const { emit, events } = recordingEmit();
  const lines: string[] = [];
  const log = createLogger((line) => lines.push(line));
  return { fake, emit, events, lines, log };
}

const deadlock = () =>
  new FakeDbError("P2034", "Transaction failed due to a write conflict or a deadlock.");

describe("transact", () => {
  it("delivers the events a transaction emitted after the commit, in order", async () => {
    const { fake, emit, events } = seeded();
    const order: string[] = [];
    const result = await transact(fake.db, emit, async (tx, emitLater) => {
      await tx.membership.create({ data: { userId: "u1", spaceId: "s1", role: "owner" } });
      await emitLater("s1", "member.joined", { userId: "u1", role: "owner" });
      await emitLater("s1", "member.updated", { userId: "u1" });
      order.push("write");
      expect(events).toEqual([]);
      return "ok";
    });
    expect(result).toBe("ok");
    expect(events.map((e) => e.type)).toEqual(["member.joined", "member.updated"]);
    expect(order).toEqual(["write"]);
  });

  it("delivers no event when the transaction rolls back", async () => {
    const { fake, emit, events } = seeded();
    await expect(
      transact(fake.db, emit, async (tx, emitLater) => {
        await tx.membership.create({ data: { userId: "u1", spaceId: "s1", role: "owner" } });
        await emitLater("s1", "member.joined", { userId: "u1", role: "owner" });
        throw new HttpError(409, "last-owner");
      }),
    ).rejects.toMatchObject({ code: "last-owner" });
    expect(fake.rows("membership")).toEqual([]);
    expect(events).toEqual([]);
  });

  it("retries a transaction SQL Server killed as a deadlock victim (P2034), without the first attempt's events", async () => {
    const { fake, emit, events } = seeded();
    let attempts = 0;
    const result = await transact(
      fake.db,
      emit,
      async (tx, emitLater) => {
        attempts += 1;
        await emitLater("s1", "member.updated", { userId: "u1" });
        if (attempts === 1) throw deadlock();
        await tx.membership.create({ data: { userId: "u1", spaceId: "s1", role: "owner" } });
        return attempts;
      },
      { serializable: true },
    );
    expect(result).toBe(2);
    expect(fake.rows("membership")).toHaveLength(1);
    expect(events).toHaveLength(1);
    expect(fake.transactions).toEqual([
      { isolationLevel: "Serializable" },
      { isolationLevel: "Serializable" },
    ]);
  });

  it("gives up on a deadlock that repeats on every attempt, and retries nothing else", async () => {
    const { fake, emit } = seeded();
    fake.onTransaction = () => {
      throw deadlock();
    };
    await expect(transact(fake.db, emit, () => Promise.resolve())).rejects.toMatchObject({
      code: "P2034",
    });
    expect(fake.transactions).toHaveLength(TRANSACTION_ATTEMPTS);

    fake.transactions.length = 0;
    fake.onTransaction = () => {
      throw new FakeDbError("P2002", "Unique constraint failed");
    };
    await expect(transact(fake.db, emit, () => Promise.resolve())).rejects.toMatchObject({
      code: "P2002",
    });
    expect(fake.transactions).toHaveLength(1);
  });

  it("logs an emit that fails after the commit and still returns, so the committed write stands", async () => {
    const { fake, events, lines, log } = seeded();
    let calls = 0;
    const failingEmit = (spaceId: string, type: string, payload: unknown) => {
      calls += 1;
      if (calls === 1) return Promise.reject(new Error("Example Owner's secret"));
      events.push({ spaceId, type: type as never, payload });
      return Promise.resolve(undefined);
    };
    const result = await transact(
      fake.db,
      failingEmit as never,
      async (tx, emitLater) => {
        await tx.membership.create({ data: { userId: "u1", spaceId: "s1", role: "owner" } });
        await emitLater("s1", "member.joined", { userId: "u1", role: "owner" });
        await emitLater("s1", "member.updated", { userId: "u1" });
        return "committed";
      },
      { log },
    );
    expect(result).toBe("committed");
    expect(fake.rows("membership")).toHaveLength(1);
    // The later event is still delivered; the failed one is logged with ids only.
    expect(events.map((e) => e.type)).toEqual(["member.updated"]);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      level: "error",
      msg: "event.emit-failed",
      spaceId: "s1",
      code: "emit-failed",
      error: "Error",
    });
    expect(lines[0]).not.toContain("Example Owner");
  });
});

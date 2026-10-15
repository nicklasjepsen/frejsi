// @vitest-environment node
import { createLogger, HttpError } from "@frejsi/shared";
import { describe, expect, it } from "vitest";

import { transact, TRANSACTION_ATTEMPTS } from "./core";
import { FakeAuthDb, FakeDbError, recordingSink } from "./test-support";

function seeded() {
  const fake = new FakeAuthDb();
  fake.rows("space").push({
    id: "s1",
    name: "Example space",
    timezone: "Europe/Copenhagen",
    lastSeq: 0,
  });
  fake.rows("user").push({ id: "u1", name: "Example Owner" });
  const { sink, events, published } = recordingSink();
  const lines: string[] = [];
  const log = createLogger((line) => lines.push(line));
  return { fake, sink, events, published, lines, log };
}

const deadlock = () =>
  new FakeDbError("P2034", "Transaction failed due to a write conflict or a deadlock.");

describe("transact", () => {
  it("delivers the events a transaction emitted after the commit, in order", async () => {
    const { fake, sink, events, published } = seeded();
    const order: string[] = [];
    const result = await transact(fake.db, sink, async (tx, emitLater) => {
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
    // The rows went in with the write, seq allocated on the space, and went out to the space group.
    expect(fake.rows("event").map((e) => [e.seq, e.type])).toEqual([
      [1, "member.joined"],
      [2, "member.updated"],
    ]);
    expect(fake.rows("space")[0]).toMatchObject({ lastSeq: 2 });
    expect(published.map((p) => p.group)).toEqual(["space-s1", "space-s1"]);
  });

  it("delivers no event when the transaction rolls back", async () => {
    const { fake, sink, events } = seeded();
    await expect(
      transact(fake.db, sink, async (tx, emitLater) => {
        await tx.membership.create({ data: { userId: "u1", spaceId: "s1", role: "owner" } });
        await emitLater("s1", "member.joined", { userId: "u1", role: "owner" });
        throw new HttpError(409, "last-owner");
      }),
    ).rejects.toMatchObject({ code: "last-owner" });
    expect(fake.rows("membership")).toEqual([]);
    expect(fake.rows("event")).toEqual([]);
    expect(fake.rows("space")[0]).toMatchObject({ lastSeq: 0 });
    expect(events).toEqual([]);
  });

  it("retries a transaction SQL Server killed as a deadlock victim (P2034), without the first attempt's events", async () => {
    const { fake, sink, events } = seeded();
    let attempts = 0;
    const result = await transact(
      fake.db,
      sink,
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
    expect(fake.rows("event")).toHaveLength(1);
    expect(events).toHaveLength(1);
    expect(fake.transactions).toEqual([
      { isolationLevel: "Serializable" },
      { isolationLevel: "Serializable" },
    ]);
  });

  it("gives up on a deadlock that repeats on every attempt, and retries nothing else", async () => {
    const { fake, sink } = seeded();
    fake.onTransaction = () => {
      throw deadlock();
    };
    await expect(transact(fake.db, sink, () => Promise.resolve())).rejects.toMatchObject({
      code: "P2034",
    });
    expect(fake.transactions).toHaveLength(TRANSACTION_ATTEMPTS);

    fake.transactions.length = 0;
    fake.onTransaction = () => {
      throw new FakeDbError("P2002", "Unique constraint failed");
    };
    await expect(transact(fake.db, sink, () => Promise.resolve())).rejects.toMatchObject({
      code: "P2002",
    });
    expect(fake.transactions).toHaveLength(1);
  });

  it("rolls the write back when its event row cannot be written: no write without its event", async () => {
    const { fake, sink, events } = seeded();
    fake.failNextWrite = "event";
    await expect(
      transact(fake.db, sink, async (tx, emitLater) => {
        await tx.membership.create({ data: { userId: "u1", spaceId: "s1", role: "owner" } });
        await emitLater("s1", "member.joined", { userId: "u1", role: "owner" });
      }),
    ).rejects.toThrow(/injected failure/);
    expect(fake.rows("membership")).toEqual([]);
    expect(fake.rows("event")).toEqual([]);
    expect(events).toEqual([]);
  });

  it("logs a publish that fails after the commit and still returns: the row is there for /events?since", async () => {
    const { fake, lines, log } = seeded();
    const delivered: string[] = [];
    let calls = 0;
    const flakySink = {
      publish: (group: string, envelope: { type: string }) => {
        calls += 1;
        if (calls === 1) return Promise.reject(new Error("Example Owner's secret"));
        delivered.push(`${group}:${envelope.type}`);
        return Promise.resolve();
      },
    };
    const result = await transact(
      fake.db,
      flakySink,
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
    expect(fake.rows("event").map((e) => e.type)).toEqual(["member.joined", "member.updated"]);
    // The later envelope still goes out; the failed one is logged with ids only.
    expect(delivered).toEqual(["space-s1:member.updated"]);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      level: "warn",
      msg: "event.publish-failed",
      spaceId: "s1",
      code: "publish-failed",
    });
    expect(lines[0]).not.toContain("Example Owner");
  });
});

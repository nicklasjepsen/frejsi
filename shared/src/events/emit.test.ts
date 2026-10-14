import { describe, expect, it } from "vitest";

import { createEmit, groupFor, type EmitDb, type EmitTx } from "./emit";
import { MemoryEventSink } from "./memory";

interface Call {
  kind: "increment" | "insert" | "publish";
  detail: unknown;
}

/** A fake of the two Prisma delegates emit() uses, with a visible call order. */
function fakeDb(calls: Call[], onTx?: (tx: EmitTx) => Promise<void>) {
  const lastSeq: Record<string, number> = {};
  const rows: { spaceId: string; seq: number; type: string; payload: string; ts: Date }[] = [];
  const tx: EmitTx = {
    space: {
      update: (args) => {
        calls.push({ kind: "increment", detail: args });
        lastSeq[args.where.id] = (lastSeq[args.where.id] ?? 0) + args.data.lastSeq.increment;
        return Promise.resolve({ lastSeq: lastSeq[args.where.id] ?? 0 });
      },
    },
    event: {
      create: (args) => {
        calls.push({ kind: "insert", detail: args.data });
        rows.push(args.data);
        return Promise.resolve(args.data);
      },
    },
  };
  const db: EmitDb = {
    $transaction: async (fn) => {
      const result = await fn(tx);
      if (onTx) await onTx(tx);
      return result;
    },
  };
  return { db, rows };
}

const ts = "2026-10-15T08:00:00.000Z";

describe("emit", () => {
  it("allocates seq with one atomic increment of Space.lastSeq and inserts (spaceId, seq)", async () => {
    const calls: Call[] = [];
    const { db, rows } = fakeDb(calls);
    const sink = new MemoryEventSink();
    const emit = createEmit({ db, sink, now: () => new Date(ts) });

    const first = await emit("s1", "member.joined", { userId: "u1", role: "carer" });
    const second = await emit("s1", "member.removed", { userId: "u1" });
    const other = await emit("s2", "space.updated", { fields: ["name"] });

    expect([first.seq, second.seq, other.seq]).toEqual([1, 2, 1]);
    expect(calls.filter((c) => c.kind === "increment")).toHaveLength(3);
    expect(calls[0]).toEqual({
      kind: "increment",
      detail: {
        where: { id: "s1" },
        data: { lastSeq: { increment: 1 } },
        select: { lastSeq: true },
      },
    });
    expect(rows.map((r) => [r.spaceId, r.seq, r.type])).toEqual([
      ["s1", 1, "member.joined"],
      ["s1", 2, "member.removed"],
      ["s2", 1, "space.updated"],
    ]);
    expect(JSON.parse(rows[0]?.payload ?? "")).toEqual({ userId: "u1", role: "carer" });
  });

  it("publishes reading to space-<id>-glucose and every other type to space-<id>, after the insert", async () => {
    const calls: Call[] = [];
    const { db } = fakeDb(calls);
    const sink = new MemoryEventSink();
    const publishOrder: string[] = [];
    const spy: typeof sink.publish = async (group, envelope) => {
      calls.push({ kind: "publish", detail: group });
      publishOrder.push(group);
      await sink.publish(group, envelope);
    };
    const emit = createEmit({ db, sink: { publish: spy }, now: () => new Date(ts) });

    await emit("s1", "reading", { ts, mmol: 6.2, trend: "flat" });
    await emit("s1", "source.status", { status: "connected", since: ts });
    await emit("s1", "invite.created", { tokenHash: "h", role: "viewer", name: "Example" });
    await emit("s1", "device.removed", { userId: "u1", passkeyId: "p1" });

    expect(sink.forGroup("space-s1-glucose").map((e) => e.type)).toEqual(["reading"]);
    expect(sink.forGroup("space-s1").map((e) => e.type)).toEqual([
      "source.status",
      "invite.created",
      "device.removed",
    ]);
    expect(calls.map((c) => c.kind)).toEqual([
      "increment",
      "insert",
      "publish",
      "increment",
      "insert",
      "publish",
      "increment",
      "insert",
      "publish",
      "increment",
      "insert",
      "publish",
    ]);
    const reading = sink.forGroup("space-s1-glucose")[0];
    expect(reading).toEqual({
      spaceId: "s1",
      seq: 1,
      ts,
      type: "reading",
      payload: { ts, mmol: 6.2, trend: "flat" },
    });
  });

  it("names the groups with hyphens", () => {
    expect(groupFor("abc", "reading")).toBe("space-abc-glucose");
    expect(groupFor("abc", "member.joined")).toBe("space-abc");
  });

  it("rejects a payload that does not match the type before writing anything", async () => {
    const calls: Call[] = [];
    const { db } = fakeDb(calls);
    const emit = createEmit({ db, sink: new MemoryEventSink() });
    await expect(
      // @ts-expect-error a reading payload is not a member payload
      emit("s1", "member.joined", { ts, mmol: 6.2, trend: "flat" }),
    ).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it("keeps the row when publishing fails: clients catch up through events?since", async () => {
    const calls: Call[] = [];
    const { db, rows } = fakeDb(calls);
    const lines: string[] = [];
    const emit = createEmit({
      db,
      sink: {
        publish: () => Promise.reject(new Error("Web PubSub is down for Example Person")),
      },
      log: (line) => lines.push(line),
    });
    const envelope = await emit("s1", "member.removed", { userId: "u1" });
    expect(envelope.seq).toBe(1);
    expect(rows).toHaveLength(1);
    expect(lines.join("\n")).toContain("publish-failed");
    expect(lines.join("\n")).not.toContain("Example Person");
  });
});

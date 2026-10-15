import { describe, expect, it } from "vitest";

import { createEmit, type EmitDb, type EmitTx } from "../../events/emit";
import { MemoryEventSink } from "../../events/memory";
import type { Reading } from "../../schemas/glucose";
import { IMPORT_BATCH, IMPORT_TOLERANCE_MS, storeImportedReadings, type ImportDb } from "./store";

const now = new Date("2026-10-15T12:00:00.000Z");
const at = (minutes: number, seconds = 0) =>
  new Date(Date.UTC(2026, 9, 14, 7, minutes, seconds)).toISOString();
const reading = (ts: string, mmol = 6.0): Reading => ({ ts, mmol, trend: "flat" });

function fakeDb(seed: { ts: string }[] = []) {
  const rows: { spaceId: string; ts: Date; mmol: number; trend: string; source: string }[] =
    seed.map((r) => ({ spaceId: "s1", ts: new Date(r.ts), mmol: 5, trend: "flat", source: "x" }));
  const space = { id: "s1", lastReadingAt: null as Date | null, lastSeq: 0 };
  const calls: string[] = [];
  const events: { type: string; payload: unknown }[] = [];
  /** A row the poller stores between the check and the insert, once. */
  let raceOnce: string | null = null;
  const db: ImportDb = {
    reading: {
      findMany: (args) => {
        calls.push("findMany");
        return Promise.resolve(
          rows
            .filter(
              (r) =>
                r.spaceId === args.where.spaceId &&
                r.ts >= args.where.ts.gte &&
                r.ts <= args.where.ts.lte,
            )
            .map((r) => ({ ts: r.ts })),
        );
      },
      createMany: (args) => {
        calls.push(`createMany:${args.data.length}`);
        if (raceOnce) {
          rows.push({ spaceId: "s1", ts: new Date(raceOnce), mmol: 5, trend: "flat", source: "x" });
          raceOnce = null;
        }
        for (const row of args.data) {
          if (rows.some((r) => r.spaceId === row.spaceId && r.ts.getTime() === row.ts.getTime())) {
            return Promise.reject(
              Object.assign(new Error("Unique constraint failed on the fields: (`spaceId`,`ts`)"), {
                code: "P2002",
              }),
            );
          }
        }
        rows.push(...args.data);
        return Promise.resolve({ count: args.data.length });
      },
    },
    space: {
      updateMany: (args) => {
        calls.push("space.updateMany");
        const current = space.lastReadingAt;
        const moves = current === null || current < args.data.lastReadingAt;
        if (moves) space.lastReadingAt = args.data.lastReadingAt;
        return Promise.resolve({ count: moves ? 1 : 0 });
      },
    },
  };
  const tx: EmitTx = {
    space: {
      update: (args) => {
        space.lastSeq += args.data.lastSeq.increment;
        return Promise.resolve({ lastSeq: space.lastSeq });
      },
    },
    event: {
      create: (args) => {
        events.push({ type: args.data.type, payload: JSON.parse(args.data.payload) as unknown });
        return Promise.resolve(args.data);
      },
    },
  };
  const emitDb: EmitDb = { $transaction: (fn) => fn(tx) };
  const sink = new MemoryEventSink();
  const emit = createEmit({ db: emitDb, sink, now: () => now });
  return {
    rows,
    space,
    calls,
    events,
    sink,
    deps: { db, emit, source: "import:clarity" },
    race: (ts: string) => {
      raceOnce = ts;
    },
  };
}

describe("storeImportedReadings", () => {
  it("stores what is new with the import source, moves lastReadingAt forward and emits one event for the lot", async () => {
    const h = fakeDb();
    const readings = [reading(at(0)), reading(at(5)), reading(at(10))];
    const result = await storeImportedReadings(h.deps, "s1", readings);
    expect(result).toEqual({ added: 3, skipped: 0, from: at(0), to: at(10) });
    expect(h.rows.map((r) => r.source)).toEqual([
      "import:clarity",
      "import:clarity",
      "import:clarity",
    ]);
    expect(h.space.lastReadingAt?.toISOString()).toBe(at(10));
    expect(h.events).toEqual([
      { type: "readings.imported", payload: { count: 3, from: at(0), to: at(10) } },
    ]);
    expect(h.sink.forGroup("space-s1-glucose")).toHaveLength(1);
    expect(h.sink.forGroup("space-s1")).toHaveLength(0);
  });

  it("adds nothing and emits nothing the second time", async () => {
    const h = fakeDb();
    const readings = [reading(at(0)), reading(at(5))];
    await storeImportedReadings(h.deps, "s1", readings);
    const again = await storeImportedReadings(h.deps, "s1", readings);
    expect(again).toEqual({ added: 0, skipped: 2, from: at(0), to: at(5) });
    expect(h.rows).toHaveLength(2);
    expect(h.events).toHaveLength(1);
  });

  it("treats a reading within a minute of a stored one as the same reading", async () => {
    const h = fakeDb([{ ts: at(0, 10) }, { ts: at(10, 0) }]);
    // 0:12 is the stored 0:10; 5:40 is the file's own 5:12 again; 10:59 is the stored 10:00.
    const result = await storeImportedReadings(h.deps, "s1", [
      reading(at(0, 12)),
      reading(at(5, 12)),
      reading(at(5, 40)),
      reading(at(10, 59)),
    ]);
    expect(result.added).toBe(1);
    expect(result.skipped).toBe(3);
    expect(h.rows.map((r) => r.ts.toISOString())).toContain(at(5, 12));
    expect(IMPORT_TOLERANCE_MS).toBe(60_000);
  });

  it("does not move lastReadingAt back when the import is older than the live readings", async () => {
    const h = fakeDb();
    h.space.lastReadingAt = new Date("2026-10-15T11:55:00.000Z");
    await storeImportedReadings(h.deps, "s1", [reading(at(0))]);
    expect(h.space.lastReadingAt.toISOString()).toBe("2026-10-15T11:55:00.000Z");
  });

  it("inserts in batches and keeps going when the poller stored an instant in between", async () => {
    const h = fakeDb();
    const readings = Array.from({ length: IMPORT_BATCH + 50 }, (_, i) =>
      reading(new Date(Date.UTC(2026, 9, 1, 0, 0, 0) + i * 5 * 60_000).toISOString()),
    );
    h.race(readings[3]?.ts ?? "");
    const result = await storeImportedReadings(h.deps, "s1", readings);
    expect(result.added).toBe(IMPORT_BATCH + 49);
    expect(h.calls.filter((c) => c.startsWith("createMany"))).toEqual([
      `createMany:${IMPORT_BATCH}`,
      `createMany:${IMPORT_BATCH - 1}`,
      "createMany:50",
    ]);
    expect(h.rows).toHaveLength(IMPORT_BATCH + 50);
  });

  it("is a no-op for no readings", async () => {
    const h = fakeDb();
    expect(await storeImportedReadings(h.deps, "s1", [])).toEqual({
      added: 0,
      skipped: 0,
      from: null,
      to: null,
    });
    expect(h.calls).toEqual([]);
  });
});

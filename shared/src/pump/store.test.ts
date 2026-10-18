import { describe, expect, it } from "vitest";

import { MemoryEventSink } from "../events/memory";
import { createLogger } from "../log";
import {
  createPumpWriter,
  PUMP_MEAL_SOURCE,
  PUMP_TX_MAX_WAIT_MS,
  PUMP_TX_TIMEOUT_MS,
  pumpMealData,
  splitByDay,
  type PumpDb,
  type PumpTx,
} from "./store";

const now = new Date("2026-10-15T18:00:00.000Z");

/**
 * A database whose transactions record their options and can be told to fail; the tx records
 * the event rows and the space's sequence, as `emit()` writes them. Rolled-back rows are dropped.
 */
function txDb(failures: (string | undefined)[] = []) {
  const options: unknown[] = [];
  const committed: { type: string; seq: number }[] = [];
  let lastSeq = 0;
  const db = {
    $transaction: async <T>(work: (tx: PumpTx) => Promise<T>, opts: unknown): Promise<T> => {
      options.push(opts);
      const rows: { type: string; seq: number }[] = [];
      let seq = lastSeq;
      const tx = {
        space: {
          update: () => {
            seq += 1;
            return Promise.resolve({ lastSeq: seq });
          },
        },
        event: {
          create: (args: { data: { type: string; seq: number } }) => {
            rows.push({ type: args.data.type, seq: args.data.seq });
            return Promise.resolve({});
          },
        },
      } as unknown as PumpTx;
      const result = await work(tx);
      const failure = failures.shift();
      if (failure !== undefined) {
        throw Object.assign(new Error("Transaction failed"), { code: failure });
      }
      committed.push(...rows);
      lastSeq = seq;
      return result;
    },
  } as unknown as PumpDb;
  return { db, options, committed };
}

const imported = { count: 1, from: now.toISOString(), to: now.toISOString() };

describe("createPumpWriter", () => {
  it("runs the work in one Serializable transaction with an explicit timeout", async () => {
    const h = txDb();
    const sink = new MemoryEventSink();
    const write = createPumpWriter({ db: h.db, sink, now: () => now });
    await write((_tx, emit) => emit("s1", "pump.imported", imported));
    expect(h.options).toEqual([
      { isolationLevel: "Serializable", timeout: PUMP_TX_TIMEOUT_MS, maxWait: PUMP_TX_MAX_WAIT_MS },
    ]);
    expect(PUMP_TX_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it("writes the event row in the same transaction and publishes it only after the commit", async () => {
    const h = txDb();
    const sink = new MemoryEventSink();
    const write = createPumpWriter({ db: h.db, sink, now: () => now });
    await write(async (_tx, emit) => {
      await emit("s1", "pump.imported", imported);
      expect(sink.published).toEqual([]);
    });
    expect(h.committed).toEqual([{ type: "pump.imported", seq: 1 }]);
    expect(sink.published.map((p) => [p.group, p.envelope.type])).toEqual([
      ["space-s1-glucose", "pump.imported"],
    ]);
  });

  it("retries once on a serialization failure and publishes only the attempt that committed", async () => {
    const h = txDb(["P2034"]);
    const sink = new MemoryEventSink();
    const write = createPumpWriter({ db: h.db, sink, now: () => now });
    let attempts = 0;
    await write(async (_tx, emit) => {
      attempts += 1;
      await emit("s1", "pump.imported", imported);
    });
    expect(attempts).toBe(2);
    expect(h.committed).toHaveLength(1);
    expect(sink.published).toHaveLength(1);
  });

  it("retries once when a concurrent run inserted the same bolus first", async () => {
    const h = txDb(["P2002"]);
    const write = createPumpWriter({ db: h.db, sink: new MemoryEventSink(), now: () => now });
    let attempts = 0;
    await write(() => {
      attempts += 1;
      return Promise.resolve();
    });
    expect(attempts).toBe(2);
  });

  it("gives up after the second failure and publishes nothing", async () => {
    const h = txDb(["P2034", "P2034"]);
    const sink = new MemoryEventSink();
    const write = createPumpWriter({ db: h.db, sink, now: () => now });
    const error = await write((_tx, emit) => emit("s1", "pump.imported", imported)).catch(
      (e: unknown) => e,
    );
    expect(error).toMatchObject({ code: "P2034" });
    expect(h.options).toHaveLength(2);
    expect(h.committed).toEqual([]);
    expect(sink.published).toEqual([]);
  });

  it("does not retry any other failure", async () => {
    const h = txDb(["P2028"]);
    const write = createPumpWriter({ db: h.db, sink: new MemoryEventSink(), now: () => now });
    await expect(write(() => Promise.resolve())).rejects.toMatchObject({ code: "P2028" });
    expect(h.options).toHaveLength(1);
  });

  it("logs a failed publish with codes only and keeps the commit", async () => {
    const h = txDb();
    const lines: string[] = [];
    const write = createPumpWriter({
      db: h.db,
      sink: { publish: () => Promise.reject(new Error("down at example-pubsub.invalid")) },
      now: () => now,
      log: createLogger((line) => lines.push(line)),
    });
    await write((_tx, emit) => emit("s1", "pump.imported", imported));
    expect(h.committed).toHaveLength(1);
    expect(lines.join("\n")).toContain('"code":"publish-failed"');
    expect(lines.join("\n")).not.toContain("example-pubsub");
  });
});

describe("pumpMealData", () => {
  const bolus = { id: "b1", ts: new Date("2026-10-15T11:58:00.000Z"), carbs: 45 };

  it("is an unverified meal: source pump, one manual line with the carbs and no food", () => {
    const data = pumpMealData("s1", bolus, { userId: "u-owner", locale: "da" });
    expect(PUMP_MEAL_SOURCE).toBe("pump");
    expect(data).toEqual({
      spaceId: "s1",
      ts: bolus.ts,
      byUserId: "u-owner",
      totalCarbs: 45,
      note: null,
      symbol: "unknown",
      source: "pump",
      pumpBolusId: "b1",
      bolusTs: bolus.ts,
      items: { create: [{ name: "Kulhydrater fra pumpen", carbs: 45, position: 0 }] },
    });
    expect(JSON.stringify(data)).not.toContain("foodId");
  });

  it("names the line in the connecting owner's locale", () => {
    const data = pumpMealData("s1", bolus, { userId: "u-owner", locale: "en" });
    expect(data.items.create).toEqual([{ name: "Carbs from the pump", carbs: 45, position: 0 }]);
  });
});

describe("splitByDay", () => {
  const at = (iso: string) => ({ ts: iso });

  it("groups records into consecutive 24-hour slices from the oldest, oldest first", () => {
    const records = [
      at("2026-10-03T08:00:00.000Z"),
      at("2026-10-01T10:00:00.000Z"),
      at("2026-10-02T09:59:59.000Z"),
      at("2026-10-02T10:00:00.000Z"),
      at("2026-10-01T23:00:00.000Z"),
    ];
    expect(splitByDay(records).map((day) => day.map((r) => r.ts))).toEqual([
      ["2026-10-01T10:00:00.000Z", "2026-10-01T23:00:00.000Z", "2026-10-02T09:59:59.000Z"],
      ["2026-10-02T10:00:00.000Z", "2026-10-03T08:00:00.000Z"],
    ]);
  });

  it("gives nothing for nothing", () => {
    expect(splitByDay([])).toEqual([]);
  });
});

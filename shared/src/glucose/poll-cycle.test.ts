import { describe, expect, it } from "vitest";

import { createEmit, type EmitDb, type EmitTx } from "../events/emit";
import { MemoryEventSink } from "../events/memory";
import { createLogger } from "../log";
import type { GlucoseSourceConfig, Reading, SourceStatus } from "../schemas/glucose";
import { DexcomShareSource } from "./dexcom-share/source";
import { fakeDexcom } from "./dexcom-share/test-server";
import { FakeGlucoseSource } from "./fake";
import {
  runPollCycle,
  sinceFor,
  type PollDb,
  type PollSpaceRow,
  type SourceFactory,
} from "./poll-cycle";
import type { GlucoseSource } from "./types";

const now = new Date("2026-10-15T10:27:00.000Z");
const MINUTE = 60_000;
const dexcomConfig: GlucoseSourceConfig = {
  type: "dexcom-share",
  region: "eu",
  secretRef: "glucose-s1",
};

interface SpaceState extends PollSpaceRow {
  lastSeq: number;
}

/** In-memory Space, Reading and Event tables with the Prisma shapes the cycle and emit() use. */
function fakeDb(initial: Partial<SpaceState>[]) {
  const spaces = new Map<string, SpaceState>();
  for (const s of initial) {
    const id = s.id ?? "s1";
    spaces.set(id, {
      id,
      glucoseSource: s.glucoseSource === undefined ? JSON.stringify(dexcomConfig) : s.glucoseSource,
      sourceStatus: s.sourceStatus ?? "connected",
      sourceFailures: s.sourceFailures ?? 0,
      lastReadingAt: s.lastReadingAt ?? null,
      lastSeq: s.lastSeq ?? 0,
    });
  }
  const readings = new Map<
    string,
    { spaceId: string; ts: Date; mmol: number; trend: string; source: string }
  >();
  const events: { spaceId: string; seq: number; type: string }[] = [];
  const key = (spaceId: string, ts: Date) => `${spaceId}|${ts.toISOString()}`;
  const must = (id: string) => {
    const space = spaces.get(id);
    if (!space) throw new Error(`no space ${id}`);
    return space;
  };

  const poll: PollDb = {
    space: {
      findMany: (args) =>
        Promise.resolve(
          [...spaces.values()]
            .filter((s) => s.glucoseSource !== null && (!args.where.id || s.id === args.where.id))
            .map(({ lastSeq: _lastSeq, ...row }) => row),
        ),
      update: (args) => {
        const space = must(args.where.id);
        const { sourceFailures, ...rest } = args.data;
        Object.assign(space, rest);
        if (typeof sourceFailures === "number") space.sourceFailures = sourceFailures;
        else if (sourceFailures) space.sourceFailures += sourceFailures.increment;
        return Promise.resolve({
          sourceFailures: space.sourceFailures,
          sourceStatus: space.sourceStatus,
        });
      },
      // The conditional write: every `where` field after `id` must match the row as it is now.
      updateMany: (args) => {
        const space = must(args.where.id);
        const { sourceStatus, sourceFailures, OR } = args.where;
        if (sourceStatus !== undefined && space.sourceStatus !== sourceStatus) {
          return Promise.resolve({ count: 0 });
        }
        if (sourceFailures !== undefined && space.sourceFailures !== sourceFailures) {
          return Promise.resolve({ count: 0 });
        }
        if (OR) {
          const current = space.lastReadingAt;
          const newer = OR.some((c) =>
            "lastReadingAt" in c && c.lastReadingAt === null
              ? current === null
              : current !== null && "lt" in c.lastReadingAt && current < c.lastReadingAt.lt,
          );
          if (!newer) return Promise.resolve({ count: 0 });
        }
        Object.assign(space, args.data);
        return Promise.resolve({ count: 1 });
      },
    },
    reading: {
      findMany: (args) =>
        Promise.resolve(
          args.where.ts.in
            .filter((ts) => readings.has(key(args.where.spaceId, ts)))
            .map((ts) => ({ ts })),
        ),
      create: (args) => {
        const k = key(args.data.spaceId, args.data.ts);
        if (readings.has(k)) {
          return Promise.reject(
            Object.assign(new Error("Unique constraint failed on the fields: (`spaceId`,`ts`)"), {
              code: "P2002",
            }),
          );
        }
        readings.set(k, args.data);
        return Promise.resolve(args.data);
      },
      delete: (args) => {
        readings.delete(key(args.where.spaceId_ts.spaceId, args.where.spaceId_ts.ts));
        return Promise.resolve(undefined);
      },
    },
  };

  const tx: EmitTx = {
    space: {
      update: (args) => {
        const space = must(args.where.id);
        space.lastSeq += args.data.lastSeq.increment;
        return Promise.resolve({ lastSeq: space.lastSeq });
      },
    },
    event: {
      create: (args) => {
        events.push({ spaceId: args.data.spaceId, seq: args.data.seq, type: args.data.type });
        return Promise.resolve(args.data);
      },
    },
  };
  const emitDb: EmitDb = { $transaction: (fn) => fn(tx) };

  return { poll, emitDb, spaces, readings, events };
}

function recordingSource(
  readings: Reading[] = [],
  fail?: Error,
): GlucoseSource & { calls: Date[] } {
  const calls: Date[] = [];
  return {
    calls,
    fetchSince: (since) => {
      calls.push(since);
      return fail
        ? Promise.reject(fail)
        : Promise.resolve(readings.filter((r) => Date.parse(r.ts) > since.getTime()));
    },
    probe: () => Promise.resolve("ok"),
  };
}

function harness(initial: Partial<SpaceState>[], sources: SourceFactory) {
  const db = fakeDb(initial);
  const sink = new MemoryEventSink();
  const realEmit = createEmit({ db: db.emitDb, sink, now: () => now });
  const emitFailure = { error: null as Error | null };
  /** Lets a test hold one emit until another cycle has gone past it. */
  const emitGate = { wait: null as ((type: string, payload: unknown) => Promise<void>) | null };
  const emit: typeof realEmit = async (spaceId, type, payload) => {
    if (emitFailure.error) throw emitFailure.error;
    await emitGate.wait?.(type, payload);
    return realEmit(spaceId, type, payload);
  };
  const lines: string[] = [];
  const log = createLogger(
    (line) => lines.push(line),
    () => now,
  );
  const stored: string[] = [];
  const run = (spaceId?: string) =>
    runPollCycle(
      { db: db.poll, emit, sources, now: () => now, log, onReadingStored: (id) => stored.push(id) },
      spaceId === undefined ? {} : { spaceId },
    );
  return { ...db, sink, lines, stored, run, emitFailure, emitGate };
}

/** A promise with its resolver in hand, for holding one cycle until another is done. */
function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

const statusOf = (sink: MemoryEventSink, spaceId: string): SourceStatus[] =>
  sink
    .forGroup(`space-${spaceId}`)
    .filter((e) => e.type === "source.status")
    .map((e) => (e.payload as { status: SourceStatus }).status);

describe("sinceFor", () => {
  it("is 30 minutes for a space with a recent reading and a day for a space with none", () => {
    expect(sinceFor(new Date(now.getTime() - 7 * MINUTE), now)).toEqual(
      new Date(now.getTime() - 30 * MINUTE),
    );
    expect(sinceFor(null, now)).toEqual(new Date(now.getTime() - 1440 * MINUTE));
  });

  it("reaches back to the last reading after an outage, up to a day", () => {
    const twoHoursAgo = new Date(now.getTime() - 120 * MINUTE);
    expect(sinceFor(twoHoursAgo, now)).toEqual(twoHoursAgo);
    expect(sinceFor(new Date(now.getTime() - 3 * 1440 * MINUTE), now)).toEqual(
      new Date(now.getTime() - 1440 * MINUTE),
    );
  });
});

describe("runPollCycle windows", () => {
  it("asks the source for 30 minutes when the space has readings and a day when it has none", async () => {
    const withReadings = recordingSource();
    const empty = recordingSource();
    const h = harness(
      [
        { id: "s1", lastReadingAt: new Date(now.getTime() - 5 * MINUTE) },
        { id: "s2", lastReadingAt: null },
      ],
      (space) => (space.id === "s1" ? withReadings : empty),
    );
    await h.run();
    expect(withReadings.calls).toEqual([new Date(now.getTime() - 30 * MINUTE)]);
    expect(empty.calls).toEqual([new Date(now.getTime() - 1440 * MINUTE)]);
  });

  it("makes the Dexcom adapter fetch minutes=30&maxCount=6, and 1440/288 for an empty space", async () => {
    const dexcom = fakeDexcom();
    const h = harness(
      [
        { id: "s1", lastReadingAt: new Date(now.getTime() - 5 * MINUTE) },
        { id: "s2", lastReadingAt: null },
      ],
      (_space, config) =>
        new DexcomShareSource({
          region: config.region,
          username: "publisher@example.invalid",
          password: "<fixture-password>",
          fetch: dexcom.fetch,
          now: () => now,
        }),
    );
    await h.run();
    const windows = dexcom.calls
      .filter((c) => c.url.pathname.endsWith("ReadPublisherLatestGlucoseValues"))
      .map((c) => `${c.url.searchParams.get("minutes")}&${c.url.searchParams.get("maxCount")}`);
    expect(windows).toEqual(["30&6", "1440&288"]);
    expect(h.readings.size).toBe(12);
  });

  it("polls only the given space with the spaceId option", async () => {
    const a = recordingSource();
    const b = recordingSource();
    const h = harness([{ id: "s1" }, { id: "s2" }], (space) => (space.id === "s1" ? a : b));
    const outcomes = await h.run("s2");
    expect(outcomes.map((o) => o.spaceId)).toEqual(["s2"]);
    expect(a.calls).toEqual([]);
    expect(b.calls).toHaveLength(1);
  });

  it("skips spaces without a configured source", async () => {
    const h = harness([{ id: "s1", glucoseSource: null }], () => recordingSource());
    expect(await h.run()).toEqual([]);
  });
});

describe("runPollCycle storing and emitting", () => {
  it("upserts on (spaceId, ts), emits one reading per new row to the glucose group, and nothing the second time", async () => {
    const fake = new FakeGlucoseSource({ now: () => now });
    const h = harness([{ id: "s1", sourceStatus: "not-configured" }], () => fake);

    const [first] = await h.run();
    expect(first).toMatchObject({ spaceId: "s1", outcome: "ok", stored: 288, status: "connected" });
    expect(h.readings.size).toBe(288);
    const glucose = h.sink.forGroup("space-s1-glucose");
    expect(glucose).toHaveLength(288);
    expect(glucose.every((e) => e.type === "reading")).toBe(true);
    expect(glucose.map((e) => e.seq)).toEqual(glucose.map((_e, i) => i + 1));
    expect(h.sink.forGroup("space-s1").map((e) => e.type)).toEqual(["source.status"]);
    expect(h.stored).toHaveLength(288);
    expect(h.spaces.get("s1")?.lastReadingAt).toEqual(new Date("2026-10-15T10:25:00.000Z"));

    const [second] = await h.run();
    expect(second).toMatchObject({ spaceId: "s1", outcome: "ok", stored: 0 });
    expect(h.readings.size).toBe(288);
    expect(h.sink.published).toHaveLength(289);
    expect(h.events).toHaveLength(289);
  });

  it("stores every reading with its ts, the mmol value, the trend and the source type", async () => {
    const reading: Reading = {
      ts: "2026-10-15T10:25:00.000Z",
      mmol: 8.0,
      trend: "forty-five-down",
    };
    const h = harness([{ id: "s1", lastReadingAt: new Date(now.getTime() - 10 * MINUTE) }], () =>
      recordingSource([reading]),
    );
    await h.run();
    expect([...h.readings.values()]).toEqual([
      {
        spaceId: "s1",
        ts: new Date(reading.ts),
        mmol: 8.0,
        trend: "forty-five-down",
        source: "dexcom-share",
      },
    ]);
    const event = h.sink.forGroup("space-s1-glucose")[0];
    expect(event?.payload).toEqual(reading);
    expect(h.spaces.get("s1")?.lastReadingAt).toEqual(new Date(reading.ts));
  });

  it("keeps reading events out of the space group a viewer can join", async () => {
    const h = harness([{ id: "s1" }], () => new FakeGlucoseSource({ now: () => now }));
    await h.run();
    expect(h.sink.forGroup("space-s1").some((e) => e.type === "reading")).toBe(false);
  });

  it("does not set lastReadingAt when nothing new arrived", async () => {
    const before = new Date(now.getTime() - 4 * MINUTE);
    const h = harness([{ id: "s1", lastReadingAt: before }], () => recordingSource([]));
    await h.run();
    expect(h.spaces.get("s1")?.lastReadingAt).toEqual(before);
  });
});

describe("runPollCycle failures", () => {
  it("lets one failing space stop nothing else", async () => {
    const good = new FakeGlucoseSource({ now: () => now });
    const h = harness(
      [
        { id: "bad", lastReadingAt: now },
        { id: "good", lastReadingAt: new Date(now.getTime() - 10 * MINUTE) },
      ],
      (space) =>
        space.id === "bad" ? recordingSource([], new Error("boom for Example Person")) : good,
    );
    const outcomes = await h.run();
    expect(outcomes.map((o) => [o.spaceId, o.outcome])).toEqual([
      ["bad", "failed"],
      ["good", "ok"],
    ]);
    expect(outcomes[1]?.stored).toBe(6);
    expect(h.spaces.get("bad")?.sourceFailures).toBe(1);
    expect(h.spaces.get("bad")?.sourceStatus).toBe("connected");
  });

  it("marks the source disconnected after three consecutive failures, once, and connected again on success", async () => {
    let failing = true;
    const h = harness([{ id: "s1", lastReadingAt: new Date(now.getTime() - 5 * MINUTE) }], () =>
      failing ? recordingSource([], new Error("down")) : recordingSource([]),
    );
    await h.run();
    await h.run();
    expect(h.spaces.get("s1")).toMatchObject({ sourceFailures: 2, sourceStatus: "connected" });
    expect(statusOf(h.sink, "s1")).toEqual([]);

    const [third] = await h.run();
    expect(third).toMatchObject({ outcome: "failed", status: "disconnected" });
    expect(h.spaces.get("s1")).toMatchObject({ sourceFailures: 3, sourceStatus: "disconnected" });
    expect(statusOf(h.sink, "s1")).toEqual(["disconnected"]);
    expect(h.sink.forGroup("space-s1").at(-1)?.payload).toEqual({
      status: "disconnected",
      since: now.toISOString(),
    });

    await h.run();
    expect(h.spaces.get("s1")?.sourceFailures).toBe(4);
    expect(statusOf(h.sink, "s1")).toEqual(["disconnected"]);

    failing = false;
    const [recovered] = await h.run();
    expect(recovered).toMatchObject({ outcome: "ok", status: "connected" });
    expect(h.spaces.get("s1")).toMatchObject({ sourceFailures: 0, sourceStatus: "connected" });
    expect(statusOf(h.sink, "s1")).toEqual(["disconnected", "connected"]);

    await h.run();
    expect(statusOf(h.sink, "s1")).toEqual(["disconnected", "connected"]);
  });

  it("counts an unreadable source config and a source the factory cannot build as failures", async () => {
    const h = harness(
      [{ id: "s1", glucoseSource: '{"type":"nightscout"}' }, { id: "s2" }],
      (space) => {
        if (space.id === "s2") throw new Error("secret glucose-s2 is missing");
        return recordingSource();
      },
    );
    const outcomes = await h.run();
    expect(outcomes).toEqual([
      expect.objectContaining({ spaceId: "s1", outcome: "failed", code: "config-invalid" }),
      expect.objectContaining({ spaceId: "s2", outcome: "failed", code: "source-unavailable" }),
    ]);
    expect(h.spaces.get("s1")?.sourceFailures).toBe(1);
    expect(h.spaces.get("s2")?.sourceFailures).toBe(1);
  });

  it("keeps the readings it already stored when a later one fails", async () => {
    const readings: Reading[] = [
      { ts: "2026-10-15T10:20:00.000Z", mmol: 7.7, trend: "flat" },
      { ts: "2026-10-15T10:25:00.000Z", mmol: 99, trend: "flat" },
    ];
    const h = harness([{ id: "s1", lastReadingAt: new Date(now.getTime() - 10 * MINUTE) }], () =>
      recordingSource(readings),
    );
    const [outcome] = await h.run();
    expect(outcome).toMatchObject({ outcome: "failed", stored: 1 });
    expect(h.readings.size).toBe(1);
    expect(h.spaces.get("s1")?.lastReadingAt).toEqual(new Date("2026-10-15T10:20:00.000Z"));
    expect(h.sink.forGroup("space-s1-glucose")).toHaveLength(1);
  });

  it("logs spaceId, counts and codes only", async () => {
    const h = harness(
      [
        { id: "s1", lastReadingAt: now },
        { id: "s2", lastReadingAt: new Date(now.getTime() - 10 * MINUTE) },
      ],
      (space) =>
        space.id === "s1"
          ? recordingSource([], new Error("Login failed for publisher@example.invalid"))
          : new FakeGlucoseSource({ now: () => now }),
    );
    await h.run();
    expect(h.lines.length).toBeGreaterThanOrEqual(2);
    const output = h.lines.join("\n");
    expect(output).not.toContain("example.invalid");
    expect(output).not.toContain("Login failed");
    for (const line of h.lines) {
      const keys = Object.keys(JSON.parse(line) as object);
      expect(
        keys.every((k) =>
          ["ts", "level", "msg", "spaceId", "count", "code", "ms", "error"].includes(k),
        ),
      ).toBe(true);
    }
    expect(output).toContain('"spaceId":"s1"');
    expect(output).toContain('"count":6');
  });

  it("names the cause on the space-failed line, so a bad credential can be told from a timeout", async () => {
    const dexcom = fakeDexcom({ badCredentials: true });
    const timeout = Object.assign(new Error("deadline"), {
      name: "DexcomShareError",
      code: "Timeout",
    });
    const h = harness(
      [
        { id: "s1", lastReadingAt: now },
        { id: "s2", lastReadingAt: now },
      ],
      (space, config) =>
        space.id === "s1"
          ? new DexcomShareSource({
              region: config.region,
              username: "publisher@example.invalid",
              password: "<fixture-password>",
              fetch: dexcom.fetch,
              now: () => now,
            })
          : recordingSource([], timeout),
    );
    await h.run();
    const failed = h.lines
      .map((l) => JSON.parse(l) as { msg: string; spaceId?: string; code?: string })
      .filter((l) => l.msg === "poll.space-failed")
      // Spaces poll side by side, so the two lines can land in either order.
      .sort((a, b) => (a.spaceId ?? "").localeCompare(b.spaceId ?? ""));
    expect(failed).toEqual([
      expect.objectContaining({
        spaceId: "s1",
        code: "fetch-failed:SSO_AuthenticatePasswordInvalid",
      }),
      expect.objectContaining({ spaceId: "s2", code: "fetch-failed:Timeout" }),
    ]);
  });

  it("does not log in again with a refused credential while the space goes disconnected", async () => {
    const dexcom = fakeDexcom({ badCredentials: true });
    const source = new DexcomShareSource({
      region: "eu",
      username: "publisher@example.invalid",
      password: "<fixture-password>",
      fetch: dexcom.fetch,
      now: () => now,
    });
    // One instance per space per process, as the poller's factory keeps it.
    const h = harness([{ id: "s1", lastReadingAt: now }], () => source);
    for (let cycle = 0; cycle < 4; cycle += 1) await h.run();
    expect(h.spaces.get("s1")).toMatchObject({ sourceFailures: 4, sourceStatus: "disconnected" });
    expect(dexcom.count("authenticate")).toBe(1);
  });
});

describe("runPollCycle and a failing emit", () => {
  const reading: Reading = { ts: "2026-10-15T10:25:00.000Z", mmol: 6.2, trend: "flat" };

  it("does not keep a reading whose event could not be written, and stores both next time", async () => {
    const h = harness([{ id: "s1", lastReadingAt: new Date(now.getTime() - 10 * MINUTE) }], () =>
      recordingSource([reading]),
    );
    h.emitFailure.error = new Error("database unavailable");
    const [failed] = await h.run();
    expect(failed).toMatchObject({ outcome: "failed", code: "store-failed", stored: 0 });
    expect(h.readings.size).toBe(0);
    expect(h.events).toHaveLength(0);

    h.emitFailure.error = null;
    const [ok] = await h.run();
    expect(ok).toMatchObject({ outcome: "ok", stored: 1 });
    expect(h.readings.size).toBe(1);
    expect(h.sink.forGroup("space-s1-glucose")).toHaveLength(1);
  });

  it("emits exactly one event per row when two cycles overlap on the same space", async () => {
    const h = harness([{ id: "s1", lastReadingAt: new Date(now.getTime() - 10 * MINUTE) }], () =>
      recordingSource([reading]),
    );
    const [a, b] = await Promise.all([h.run(), h.run()]);
    expect(h.readings.size).toBe(1);
    expect(h.sink.forGroup("space-s1-glucose")).toHaveLength(1);
    expect((a[0]?.stored ?? 0) + (b[0]?.stored ?? 0)).toBe(1);
    expect(h.stored).toHaveLength(1);
  });

  it("does not record a status change whose event was not written, and retries it", async () => {
    const h = harness([{ id: "s1", sourceFailures: 2, lastReadingAt: now }], () =>
      recordingSource([], new Error("down")),
    );
    h.emitFailure.error = new Error("database unavailable");
    await h.run();
    expect(h.spaces.get("s1")?.sourceStatus).toBe("connected");
    expect(statusOf(h.sink, "s1")).toEqual([]);

    h.emitFailure.error = null;
    await h.run();
    expect(h.spaces.get("s1")?.sourceStatus).toBe("disconnected");
    expect(statusOf(h.sink, "s1")).toEqual(["disconnected"]);
  });

  it("does not count a database failure after a good fetch against the source", async () => {
    const h = harness(
      [{ id: "s1", sourceStatus: "disconnected", sourceFailures: 3, lastReadingAt: now }],
      () => recordingSource([]),
    );
    h.emitFailure.error = new Error("database unavailable");
    const [outcome] = await h.run();
    expect(outcome).toMatchObject({ outcome: "failed", code: "status-update-failed" });
    expect(h.spaces.get("s1")).toMatchObject({ sourceFailures: 3, sourceStatus: "disconnected" });
  });
});

describe("runPollCycle across spaces", () => {
  it("polls spaces concurrently, bounded, and keeps the outcomes in space order", async () => {
    let releaseSlow: (() => void) | undefined;
    const slow: GlucoseSource = {
      fetchSince: () =>
        new Promise((resolve) => {
          releaseSlow = () => {
            resolve([]);
          };
        }),
      probe: () => Promise.resolve("ok"),
    };
    const fast: GlucoseSource = {
      fetchSince: () => {
        // The slow space is still waiting when this one is asked: they run side by side.
        releaseSlow?.();
        return Promise.resolve([]);
      },
      probe: () => Promise.resolve("ok"),
    };
    const h = harness([{ id: "s1" }, { id: "s2" }, { id: "s3" }], (space) =>
      space.id === "s1" ? slow : fast,
    );
    const outcomes = await h.run();
    expect(outcomes.map((o) => o.spaceId)).toEqual(["s1", "s2", "s3"]);
    expect(outcomes.every((o) => o.outcome === "ok")).toBe(true);
  });

  it("does not count a storage failure against the source", async () => {
    const reading: Reading = { ts: "2026-10-15T10:25:00.000Z", mmol: 6.2, trend: "flat" };
    const h = harness([{ id: "s1", lastReadingAt: new Date(now.getTime() - 10 * MINUTE) }], () =>
      recordingSource([reading]),
    );
    h.emitFailure.error = new Error("database unavailable");
    const [outcome] = await h.run();
    expect(outcome).toMatchObject({ outcome: "failed", code: "store-failed" });
    expect(h.spaces.get("s1")).toMatchObject({ sourceFailures: 0, sourceStatus: "connected" });
  });

  it("never moves lastReadingAt backwards when an older batch lands after a newer one", async () => {
    const newest = new Date("2026-10-15T10:26:00.000Z");
    const older: Reading = { ts: "2026-10-15T10:20:00.000Z", mmol: 7.7, trend: "flat" };
    const h = harness([{ id: "s1", lastReadingAt: newest }], () => recordingSource([older]));
    const [outcome] = await h.run();
    expect(outcome).toMatchObject({ outcome: "ok", stored: 1 });
    expect(h.spaces.get("s1")?.lastReadingAt).toEqual(newest);
  });

  it("keeps lastReadingAt for the rows it stored even when a later row fails", async () => {
    const readings: Reading[] = [
      { ts: "2026-10-15T10:20:00.000Z", mmol: 7.7, trend: "flat" },
      { ts: "2026-10-15T10:25:00.000Z", mmol: 99, trend: "flat" },
    ];
    const h = harness([{ id: "s1", lastReadingAt: new Date("2026-10-15T10:00:00.000Z") }], () =>
      recordingSource(readings),
    );
    await h.run();
    expect(h.spaces.get("s1")?.lastReadingAt).toEqual(new Date("2026-10-15T10:20:00.000Z"));
    expect(h.spaces.get("s1")?.sourceFailures).toBe(0);
  });
});

describe("runPollCycle failure counting under overlap", () => {
  it("counts every failure once when two cycles fail at the same time", async () => {
    const h = harness([{ id: "s1", sourceFailures: 1, lastReadingAt: now }], () =>
      recordingSource([], new Error("down")),
    );
    await Promise.all([h.run(), h.run()]);
    expect(h.spaces.get("s1")).toMatchObject({ sourceFailures: 3, sourceStatus: "disconnected" });
    expect(statusOf(h.sink, "s1")).toEqual(["disconnected"]);
  });

  it("tells the clients 'connected' when a success lands after an overlapping cycle went disconnected", async () => {
    // Both cycles start from the snapshot (connected, 2 failures). A fails and writes
    // `disconnected`; B's fetch succeeds only after A is done. B's snapshot still says
    // `connected`, so a decision from the snapshot would skip the recovery event for good.
    const aDone = gate();
    let calls = 0;
    const h = harness([{ id: "s1", sourceFailures: 2, lastReadingAt: now }], () => {
      calls += 1;
      if (calls === 1) return recordingSource([], new Error("down"));
      return {
        fetchSince: () => aDone.opened.then(() => []),
        probe: () => Promise.resolve("ok" as const),
      };
    });
    const a = h.run();
    const b = h.run();
    await a;
    expect(h.spaces.get("s1")).toMatchObject({ sourceStatus: "disconnected" });
    aDone.open();
    await b;
    expect(h.spaces.get("s1")).toMatchObject({ sourceFailures: 0, sourceStatus: "connected" });
    expect(statusOf(h.sink, "s1")).toEqual(["disconnected", "connected"]);
  });

  it("does not let a late 'disconnected' write undo a success that landed in between", async () => {
    // A has counted the third failure and is emitting `disconnected` when B's success writes
    // `connected`. A's column write must not overwrite it, and the clients, who heard
    // `disconnected`, must hear `connected` after it.
    const bDone = gate();
    let calls = 0;
    const h = harness([{ id: "s1", sourceFailures: 2, lastReadingAt: now }], () => {
      calls += 1;
      return calls === 1 ? recordingSource([], new Error("down")) : recordingSource([]);
    });
    h.emitGate.wait = (_type, payload) =>
      (payload as { status?: string }).status === "disconnected" ? bDone.opened : Promise.resolve();
    const a = h.run();
    const b = h.run();
    await b;
    expect(h.spaces.get("s1")).toMatchObject({ sourceFailures: 0, sourceStatus: "connected" });
    bDone.open();
    await a;
    expect(h.spaces.get("s1")).toMatchObject({ sourceFailures: 0, sourceStatus: "connected" });
    expect(statusOf(h.sink, "s1")).toEqual(["disconnected", "connected"]);
  });
});

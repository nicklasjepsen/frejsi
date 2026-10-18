import { describe, expect, it } from "vitest";

import { MemoryEventSink } from "../events/memory";
import { createLogger } from "../log";
import type { ProbeResult } from "../schemas/glucose";
import type { PumpBolus } from "../schemas/pump";
import {
  PUMP_CONCURRENCY,
  PUMP_MEAL_GRACE_MINUTES,
  pumpSinceFor,
  runPumpCycle,
  type PumpSourceFactory,
} from "./poll-cycle";
import { PUMP_TX_MAX_WAIT_MS, PUMP_TX_TIMEOUT_MS, type PumpDb } from "./store";
import type { PumpSource } from "./types";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = new Date("2026-10-15T18:00:00.000Z");
const ago = (ms: number, from: Date = NOW) => new Date(from.getTime() - ms);
const iso = (date: Date) => date.toISOString();

interface SpaceRow {
  id: string;
  pumpSource: string | null;
  pumpStatus: string;
  pumpFailures: number;
  lastPumpAt: Date | null;
  lastSeq: number;
}
interface BolusRow {
  id: string;
  spaceId: string;
  sourceId: string;
  ts: Date;
  units: number;
  kind: string;
  carbs: number | null;
  mealDismissed: boolean;
}
interface ItemRow {
  name: string;
  carbs: number;
  position: number;
  foodId: string | null;
}
interface MealRow {
  id: string;
  spaceId: string;
  ts: Date;
  byUserId: string;
  totalCarbs: number;
  note: string | null;
  symbol: string | null;
  source: string | null;
  pumpBolusId: string | null;
  bolusTs: Date | null;
  items: ItemRow[];
}
interface EventRow {
  spaceId: string;
  seq: number;
  type: string;
  payload: unknown;
}
interface State {
  spaces: SpaceRow[];
  users: { id: string; locale: string }[];
  boluses: BolusRow[];
  meals: MealRow[];
  events: EventRow[];
}

type Where = Record<string, unknown>;

/** Prisma's filter shapes the cycle uses: equality, `in`, `gte`/`lte`, `lt`, `not: null`, `none`. */
function matches(row: Record<string, unknown>, where: Where, state: State): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === "OR") {
      return (condition as Where[]).some((c) => matches(row, c, state));
    }
    if (key === "meals") {
      return !state.meals.some((meal) => meal.pumpBolusId === row.id);
    }
    const value = row[key];
    if (condition === null) return value === null;
    if (condition instanceof Date)
      return value instanceof Date && value.getTime() === condition.getTime();
    if (typeof condition !== "object") return value === condition;
    const c = condition as { in?: unknown[]; gte?: Date; lte?: Date; lt?: Date; not?: unknown };
    if (c.in !== undefined && !c.in.includes(value)) return false;
    const time = value instanceof Date ? value.getTime() : undefined;
    if (c.gte !== undefined && (time === undefined || time < c.gte.getTime())) return false;
    if (c.lte !== undefined && (time === undefined || time > c.lte.getTime())) return false;
    if (c.lt !== undefined && (time === undefined || time >= c.lt.getTime())) return false;
    if ("not" in c && value === c.not) return false;
    return true;
  });
}

function pick<T extends object>(row: T, select: Record<string, true>): Partial<T> {
  return Object.fromEntries(
    Object.keys(select).map((key) => [key, row[key as keyof T]]),
  ) as Partial<T>;
}

const uniqueViolation = () =>
  Object.assign(new Error("Unique constraint failed on (spaceId, sourceId)"), { code: "P2002" });

/** In-memory tables with the Prisma shapes the cycle, its store and `emit()` use. */
function fakeDb(initial: Partial<State> = {}) {
  let state: State = {
    spaces: initial.spaces ?? [],
    users: initial.users ?? [{ id: "u-owner", locale: "da" }],
    boluses: initial.boluses ?? [],
    meals: initial.meals ?? [],
    events: initial.events ?? [],
  };
  const transactions: unknown[] = [];
  let nextId = 1;
  const id = (prefix: string) => `${prefix}${String(nextId++)}`;
  const reads: { table: string; where: Where }[] = [];

  const space = (spaceId: string) => {
    const row = state.spaces.find((s) => s.id === spaceId);
    if (!row) throw new Error(`no space ${spaceId}`);
    return row;
  };

  const client = {
    space: {
      findMany: (args: { where: Where; select: Record<string, true> }) => {
        reads.push({ table: "space", where: args.where });
        const { pumpSource: _p, ...rest } = args.where;
        return Promise.resolve(
          state.spaces
            .filter((s) => s.pumpSource !== null && matches({ ...s }, rest, state))
            .map((s) => pick(s, args.select)),
        );
      },
      update: (args: {
        where: { id: string };
        data: Record<string, { increment: number }>;
        select: Record<string, true>;
      }) => {
        const row = space(args.where.id) as unknown as Record<string, number>;
        for (const [key, value] of Object.entries(args.data))
          row[key] = (row[key] ?? 0) + value.increment;
        return Promise.resolve(pick(row, args.select));
      },
      updateMany: (args: { where: Where; data: Record<string, unknown> }) => {
        const row = state.spaces.find((s) => matches({ ...s }, args.where, state));
        if (!row) return Promise.resolve({ count: 0 });
        Object.assign(row, args.data);
        return Promise.resolve({ count: 1 });
      },
    },
    user: {
      findUnique: (args: { where: { id: string } }) =>
        Promise.resolve(state.users.find((u) => u.id === args.where.id) ?? null),
    },
    pumpBolus: {
      findMany: (args: { where: Where; select: Record<string, true> }) => {
        reads.push({ table: "pumpBolus", where: args.where });
        return Promise.resolve(
          state.boluses
            .filter((b) => matches({ ...b }, args.where, state))
            .map((b) => pick(b, args.select)),
        );
      },
      createMany: (args: { data: Omit<BolusRow, "id" | "mealDismissed">[] }) => {
        for (const row of args.data) {
          const taken = state.boluses.some(
            (b) => b.spaceId === row.spaceId && b.sourceId === row.sourceId,
          );
          if (taken) return Promise.reject(uniqueViolation());
        }
        for (const row of args.data)
          state.boluses.push({ ...row, id: id("b"), mealDismissed: false });
        return Promise.resolve({ count: args.data.length });
      },
    },
    meal: {
      findMany: (args: { where: Where; select: Record<string, true> }) =>
        Promise.resolve(
          state.meals
            .filter((m) => matches({ ...m }, args.where, state))
            .map((m) => pick(m, args.select)),
        ),
      updateMany: (args: { where: Where; data: Partial<MealRow> }) => {
        const rows = state.meals.filter((m) => matches({ ...m }, args.where, state));
        for (const row of rows) Object.assign(row, args.data);
        return Promise.resolve({ count: rows.length });
      },
      create: (args: {
        data: Omit<MealRow, "id" | "items"> & { items: { create: Omit<ItemRow, "foodId">[] } };
      }) => {
        const { items, ...rest } = args.data;
        const meal: MealRow = {
          ...rest,
          id: id("m"),
          items: items.create.map((item) => ({ foodId: null, ...item })),
        };
        state.meals.push(meal);
        return Promise.resolve({ id: meal.id });
      },
      deleteMany: (args: { where: Where }) => {
        const before = state.meals.length;
        state.meals = state.meals.filter((m) => !matches({ ...m }, args.where, state));
        return Promise.resolve({ count: before - state.meals.length });
      },
    },
    event: {
      create: (args: { data: { spaceId: string; seq: number; type: string; payload: string } }) => {
        const { spaceId, seq, type, payload } = args.data;
        state.events.push({ spaceId, seq, type, payload: JSON.parse(payload) as unknown });
        return Promise.resolve({});
      },
    },
  };

  const db = {
    ...client,
    $transaction: async <T>(work: (tx: typeof client) => Promise<T>, options: unknown) => {
      transactions.push(options);
      const snapshot = structuredClone(state);
      try {
        return await work(client);
      } catch (error) {
        state = snapshot;
        throw error;
      }
    },
  };

  return {
    db: db as unknown as PumpDb,
    get state() {
      return state;
    },
    transactions,
    reads,
  };
}

const CONFIG = JSON.stringify({
  type: "nightscout",
  secretRef: "pump-s1/1",
  connectedBy: "u-owner",
});

function pumpSpace(overrides: Partial<SpaceRow> = {}): SpaceRow {
  return {
    id: "s1",
    pumpSource: CONFIG,
    pumpStatus: "connected",
    pumpFailures: 0,
    lastPumpAt: null,
    lastSeq: 0,
    ...overrides,
  };
}

/** A fake PumpSource over a list of records; it can fail, stall, and records what it was asked. */
class FakePumpSource implements PumpSource {
  readonly asked: Date[] = [];
  constructor(
    public records: PumpBolus[],
    private readonly behaviour: {
      fail?: boolean;
      delayMs?: number;
      onFetch?: () => () => void;
    } = {},
  ) {}

  async fetchBolusesSince(since: Date): Promise<PumpBolus[]> {
    this.asked.push(since);
    const done = this.behaviour.onFetch?.();
    try {
      if (this.behaviour.delayMs) {
        await new Promise((resolve) => setTimeout(resolve, this.behaviour.delayMs));
      }
      if (this.behaviour.fail) throw Object.assign(new Error("refused"), { code: "401" });
      return this.records.filter((r) => Date.parse(r.ts) >= since.getTime());
    } finally {
      done?.();
    }
  }

  probe(): Promise<ProbeResult> {
    return Promise.resolve("ok");
  }
}

function bolus(sourceId: string, ts: Date, extra: Partial<PumpBolus> = {}): PumpBolus {
  return { sourceId, ts: iso(ts), units: 1, kind: "standard", ...extra };
}

const carbBolus = (ts: Date) => bolus("20", ts, { units: 2.4, carbs: 45 });

function harness(db: ReturnType<typeof fakeDb>, sources: Record<string, FakePumpSource>) {
  const lines: string[] = [];
  const sink = new MemoryEventSink();
  const built: string[] = [];
  const factory: PumpSourceFactory = (space) => {
    built.push(space.id);
    const source = sources[space.id];
    if (!source) throw new Error("secret-missing");
    return source;
  };
  const run = (now: Date = NOW) =>
    runPumpCycle({
      db: db.db,
      sources: factory,
      sink,
      now: () => now,
      log: createLogger((line) => lines.push(line)),
    });
  return { run, lines, sink, built };
}

const commitOptions = {
  isolationLevel: "Serializable",
  timeout: PUMP_TX_TIMEOUT_MS,
  maxWait: PUMP_TX_MAX_WAIT_MS,
};

const eventTypes = (db: ReturnType<typeof fakeDb>) => db.state.events.map((e) => e.type);

describe("pumpSinceFor", () => {
  it("reads fourteen days on a first run", () => {
    expect(pumpSinceFor(null, NOW)).toEqual(ago(14 * DAY));
  });

  it("reads a day when the newest stored bolus is recent", () => {
    expect(pumpSinceFor(ago(HOUR), NOW)).toEqual(ago(DAY));
  });

  it("reads back to three hours before a lastPumpAt two days old", () => {
    expect(pumpSinceFor(ago(2 * DAY), NOW)).toEqual(ago(2 * DAY + 3 * HOUR));
  });

  it("never reads more than fourteen days", () => {
    expect(pumpSinceFor(ago(20 * DAY), NOW)).toEqual(ago(14 * DAY));
  });

  it("is the window the cycle asks the source for", async () => {
    const db = fakeDb({ spaces: [pumpSpace({ lastPumpAt: ago(2 * DAY) })] });
    const source = new FakePumpSource([]);
    await harness(db, { s1: source }).run();
    expect(source.asked).toEqual([ago(2 * DAY + 3 * HOUR)]);
  });
});

describe("runPumpCycle: storing", () => {
  const records = [
    bolus("1", ago(5 * HOUR), { kind: "automatic", units: 0.6 }),
    bolus("2", ago(4 * HOUR), { units: 2.4 }),
    bolus("3", ago(3 * HOUR), { kind: "extended", units: 3 }),
  ];

  it("stores new records with one pump.imported holding only the count and the range", async () => {
    const db = fakeDb({ spaces: [pumpSpace({ lastPumpAt: ago(DAY) })] });
    const h = harness(db, { s1: new FakePumpSource(records) });
    const [outcome] = await h.run();
    expect(outcome).toMatchObject({ spaceId: "s1", outcome: "ok", code: "ok", stored: 3 });
    expect(db.state.boluses.map((b) => [b.sourceId, b.kind, b.units, b.carbs])).toEqual([
      ["1", "automatic", 0.6, null],
      ["2", "standard", 2.4, null],
      ["3", "extended", 3, null],
    ]);
    expect(db.state.events).toEqual([
      {
        spaceId: "s1",
        seq: 1,
        type: "pump.imported",
        payload: { count: 3, from: records[0]?.ts, to: records[2]?.ts },
      },
    ]);
    expect(db.state.spaces[0]?.lastPumpAt).toEqual(ago(3 * HOUR));
    expect(h.sink.published.map((p) => p.group)).toEqual(["space-s1-glucose"]);
  });

  it("stores nothing and emits nothing on a second run over the same records", async () => {
    const db = fakeDb({ spaces: [pumpSpace({ lastPumpAt: ago(DAY) })] });
    const h = harness(db, { s1: new FakePumpSource(records) });
    await h.run();
    const events = db.state.events.length;
    const transactions = db.transactions.length;
    const [again] = await h.run();
    expect(again).toMatchObject({ outcome: "ok", stored: 0 });
    expect(db.state.boluses).toHaveLength(3);
    expect(db.state.events).toHaveLength(events);
    expect(db.transactions).toHaveLength(transactions);
  });

  it("commits a first run one day at a time, each with an explicit timeout, and announces once", async () => {
    const db = fakeDb({ spaces: [pumpSpace()] });
    const first = [
      bolus("10", ago(10 * DAY), { kind: "automatic" }),
      bolus("11", ago(10 * DAY - HOUR), { kind: "automatic" }),
      bolus("12", ago(6 * DAY), { kind: "automatic" }),
      bolus("13", ago(2 * HOUR), { kind: "automatic" }),
    ];
    const h = harness(db, { s1: new FakePumpSource(first) });
    const [outcome] = await h.run();
    expect(outcome?.stored).toBe(4);
    expect(db.transactions).toEqual([commitOptions, commitOptions, commitOptions]);
    expect(eventTypes(db)).toEqual(["pump.imported"]);
    expect(db.state.events[0]?.payload).toEqual({
      count: 4,
      from: first[0]?.ts,
      to: first[3]?.ts,
    });
  });

  it("drops a record the adapter should not have returned instead of failing the space", async () => {
    const db = fakeDb({ spaces: [pumpSpace({ lastPumpAt: ago(DAY) })] });
    const bad = { sourceId: "9", ts: iso(ago(HOUR)), units: 75, kind: "standard" } as PumpBolus;
    const h = harness(db, { s1: new FakePumpSource([bad, bolus("8", ago(HOUR))]) });
    const [outcome] = await h.run();
    expect(outcome).toMatchObject({ outcome: "ok", stored: 1 });
    expect(db.state.boluses.map((b) => b.sourceId)).toEqual(["8"]);
  });
});

describe("runPumpCycle: pump meals", () => {
  it("makes no meal for a carb bolus 90 minutes old", async () => {
    const db = fakeDb({ spaces: [pumpSpace({ lastPumpAt: ago(DAY) })] });
    const h = harness(db, { s1: new FakePumpSource([carbBolus(ago(90 * MINUTE))]) });
    await h.run();
    expect(db.state.meals).toEqual([]);
    expect(eventTypes(db)).toEqual(["pump.imported"]);
  });

  it("makes exactly one pump meal at two hours, in the owner's locale, and none on the next run", async () => {
    const bolusAt = ago(90 * MINUTE);
    const db = fakeDb({
      spaces: [pumpSpace({ lastPumpAt: ago(DAY) })],
      users: [{ id: "u-owner", locale: "en" }],
    });
    const h = harness(db, { s1: new FakePumpSource([carbBolus(bolusAt)]) });
    await h.run();
    expect(PUMP_MEAL_GRACE_MINUTES).toBe(120);
    const later = new Date(bolusAt.getTime() + 2 * HOUR);
    await h.run(later);
    expect(db.state.meals).toHaveLength(1);
    const [meal] = db.state.meals;
    const stored = db.state.boluses[0];
    expect(meal).toEqual({
      id: meal?.id,
      spaceId: "s1",
      ts: bolusAt,
      byUserId: "u-owner",
      totalCarbs: 45,
      note: null,
      symbol: "unknown",
      source: "pump",
      pumpBolusId: stored?.id,
      bolusTs: bolusAt,
      items: [{ name: "Carbs from the pump", carbs: 45, position: 0, foodId: null }],
    });
    expect(db.state.events.at(-1)).toMatchObject({
      type: "pump.meals",
      payload: { updated: [], created: [meal?.id], removed: [] },
    });
    expect(eventTypes(db)).not.toContain("meal.created");

    const events = db.state.events.length;
    await h.run(new Date(later.getTime() + 15 * MINUTE));
    expect(db.state.meals).toHaveLength(1);
    expect(db.state.events).toHaveLength(events);
  });

  it("makes a pump meal in the commit that stores a bolus already past the grace", async () => {
    const db = fakeDb({ spaces: [pumpSpace({ lastPumpAt: ago(DAY) })] });
    const h = harness(db, { s1: new FakePumpSource([carbBolus(ago(3 * HOUR))]) });
    await h.run();
    expect(db.state.meals.map((m) => [m.source, m.items.length, m.items[0]?.name])).toEqual([
      ["pump", 1, "Kulhydrater fra pumpen"],
    ]);
    expect(eventTypes(db)).toEqual(["pump.imported", "pump.meals"]);
  });

  it("makes none for a bolus whose pump meal a carer deleted, an automatic bolus, or one without carbs", async () => {
    const db = fakeDb({
      spaces: [pumpSpace({ lastPumpAt: ago(3 * HOUR) })],
      boluses: [
        {
          id: "b-dismissed",
          spaceId: "s1",
          sourceId: "30",
          ts: ago(3 * HOUR),
          units: 2,
          kind: "standard",
          carbs: 40,
          mealDismissed: true,
        },
      ],
    });
    const h = harness(db, {
      s1: new FakePumpSource([
        bolus("31", ago(4 * HOUR), { kind: "automatic", carbs: 10 }),
        bolus("32", ago(4 * HOUR + 5 * MINUTE)),
      ]),
    });
    await h.run();
    await h.run(new Date(NOW.getTime() + HOUR));
    expect(db.state.meals).toEqual([]);
    expect(eventTypes(db)).toEqual(["pump.imported"]);
  });

  it("makes none when the connecting owner is gone, and still stores the record", async () => {
    const db = fakeDb({ spaces: [pumpSpace({ lastPumpAt: ago(DAY) })], users: [] });
    const h = harness(db, { s1: new FakePumpSource([carbBolus(ago(3 * HOUR))]) });
    const [outcome] = await h.run();
    expect(outcome).toMatchObject({ outcome: "ok", stored: 1 });
    expect(db.state.meals).toEqual([]);
    expect(h.lines.join("\n")).toContain('"code":"owner-missing"');
  });
});

describe("runPumpCycle: links", () => {
  function personMeal(id: string, ts: Date, extra: Partial<MealRow> = {}): MealRow {
    return {
      id,
      spaceId: "s1",
      ts,
      byUserId: "u-carer",
      totalCarbs: 40,
      note: null,
      symbol: "unknown",
      source: null,
      pumpBolusId: null,
      bolusTs: null,
      items: [{ name: "Fictional lunch", carbs: 40, position: 0, foodId: null }],
      ...extra,
    };
  }

  it("links a logged meal to the bolus near it, announced in pump.meals and never as meal.updated", async () => {
    const mealAt = ago(3 * HOUR);
    const db = fakeDb({
      spaces: [pumpSpace({ lastPumpAt: ago(DAY) })],
      meals: [personMeal("m-lunch", mealAt)],
    });
    const bolusAt = new Date(mealAt.getTime() - 10 * MINUTE);
    const h = harness(db, { s1: new FakePumpSource([carbBolus(bolusAt)]) });
    await h.run();
    const stored = db.state.boluses[0];
    expect(db.state.meals).toEqual([
      expect.objectContaining({ id: "m-lunch", pumpBolusId: stored?.id, bolusTs: bolusAt }),
    ]);
    expect(db.state.events.map((e) => [e.type, e.payload])).toEqual([
      ["pump.imported", expect.objectContaining({ count: 1 })],
      ["pump.meals", { updated: ["m-lunch"], created: [], removed: [] }],
    ]);
    expect(eventTypes(db).every((type) => type.startsWith("pump."))).toBe(true);
  });

  it("gives a bolus to the logged meal and removes the untouched pump meal it had made", async () => {
    const db = fakeDb({
      spaces: [pumpSpace({ lastPumpAt: ago(DAY) })],
      boluses: [
        {
          id: "b-old",
          spaceId: "s1",
          sourceId: "40",
          ts: ago(4 * HOUR),
          units: 2,
          kind: "standard",
          carbs: 40,
          mealDismissed: false,
        },
      ],
      meals: [
        personMeal("m-pump", ago(4 * HOUR), {
          source: "pump",
          pumpBolusId: "b-old",
          bolusTs: ago(4 * HOUR),
        }),
        personMeal("m-logged", ago(4 * HOUR - 5 * MINUTE)),
      ],
    });
    // A new bolus nearby brings the old one into the commit's neighbourhood.
    const h = harness(db, {
      s1: new FakePumpSource([bolus("41", ago(4 * HOUR - 20 * MINUTE), { kind: "automatic" })]),
    });
    await h.run();
    expect(db.state.meals.map((m) => [m.id, m.pumpBolusId])).toEqual([["m-logged", "b-old"]]);
    expect(db.state.events.at(-1)).toMatchObject({
      type: "pump.meals",
      payload: { updated: ["m-logged"], created: [], removed: ["m-pump"] },
    });
  });

  it("never links one bolus to two meals, and leaves a link it was not asked about", async () => {
    const db = fakeDb({
      spaces: [pumpSpace({ lastPumpAt: ago(DAY) })],
      boluses: [
        {
          id: "b-far",
          spaceId: "s1",
          sourceId: "50",
          ts: ago(10 * HOUR),
          units: 2,
          kind: "standard",
          carbs: null,
          mealDismissed: false,
        },
      ],
      meals: [
        personMeal("m-breakfast", ago(10 * HOUR), {
          pumpBolusId: "b-far",
          bolusTs: ago(10 * HOUR),
        }),
        personMeal("m-a", ago(3 * HOUR)),
        personMeal("m-b", ago(3 * HOUR - 20 * MINUTE)),
      ],
    });
    const h = harness(db, {
      s1: new FakePumpSource([bolus("51", ago(3 * HOUR - 8 * MINUTE))]),
    });
    await h.run();
    const linked = db.state.meals.filter((m) => m.pumpBolusId !== null);
    const byBolus = new Map<string, number>();
    for (const meal of linked)
      byBolus.set(meal.pumpBolusId ?? "", (byBolus.get(meal.pumpBolusId ?? "") ?? 0) + 1);
    expect([...byBolus.values()].every((n) => n === 1)).toBe(true);
    expect(db.state.meals.find((m) => m.id === "m-breakfast")?.pumpBolusId).toBe("b-far");
    // The bolus is 8 min after m-a and 12 min before m-b: the nearer meal takes it.
    expect(db.state.meals.find((m) => m.id === "m-a")?.pumpBolusId).toBe(
      db.state.boluses.find((b) => b.sourceId === "51")?.id,
    );
    expect(db.state.meals.find((m) => m.id === "m-b")?.pumpBolusId).toBeNull();
  });
});

describe("runPumpCycle: status", () => {
  it("sets disconnected on the third consecutive failure, emits pump.status once, and connected again on the next success", async () => {
    const db = fakeDb({ spaces: [pumpSpace({ lastPumpAt: ago(DAY) })] });
    const source = new FakePumpSource([], { fail: true });
    const h = harness(db, { s1: source });
    for (let i = 0; i < 4; i += 1) await h.run();
    expect(db.state.spaces[0]).toMatchObject({ pumpStatus: "disconnected", pumpFailures: 4 });
    expect(db.state.events.map((e) => [e.type, e.payload])).toEqual([
      ["pump.status", { status: "disconnected", since: iso(NOW) }],
    ]);

    source.records = [];
    const ok = new FakePumpSource([]);
    const recovered = harness(db, { s1: ok });
    const [outcome] = await recovered.run();
    expect(outcome).toMatchObject({ outcome: "ok", status: "connected" });
    expect(db.state.spaces[0]).toMatchObject({ pumpStatus: "connected", pumpFailures: 0 });
    expect(db.state.events.map((e) => e.type)).toEqual(["pump.status", "pump.status"]);
    expect(db.state.events.at(-1)?.payload).toEqual({ status: "connected", since: iso(NOW) });
  });

  it("does not count a failure of its own database writes against the source", async () => {
    const db = fakeDb({ spaces: [pumpSpace({ lastPumpAt: ago(DAY) })] });
    const broken = db.db as unknown as { $transaction: () => Promise<never> };
    broken.$transaction = () => Promise.reject(new Error("database down"));
    const h = harness(db, { s1: new FakePumpSource([bolus("60", ago(HOUR))]) });
    const [outcome] = await h.run();
    expect(outcome).toMatchObject({ outcome: "failed", code: "store-failed" });
    expect(db.state.spaces[0]?.pumpFailures).toBe(0);
  });

  it("counts an unreadable config and a missing secret as the source's failures", async () => {
    const db = fakeDb({
      spaces: [pumpSpace({ id: "s-bad", pumpSource: "{not json" }), pumpSpace({ id: "s-none" })],
    });
    const h = harness(db, {});
    const outcomes = await h.run();
    expect(outcomes.map((o) => [o.spaceId, o.code])).toEqual([
      ["s-bad", "config-invalid"],
      ["s-none", "source-unavailable"],
    ]);
    expect(db.state.spaces.map((s) => s.pumpFailures)).toEqual([1, 1]);
  });
});

describe("runPumpCycle: spaces", () => {
  it("never reads a space without a pump source", async () => {
    const db = fakeDb({ spaces: [pumpSpace({ id: "s-off", pumpSource: null }), pumpSpace()] });
    const h = harness(db, { s1: new FakePumpSource([]), "s-off": new FakePumpSource([]) });
    const outcomes = await h.run();
    expect(outcomes.map((o) => o.spaceId)).toEqual(["s1"]);
    expect(h.built).toEqual(["s1"]);
    expect(db.reads.filter((r) => r.where.spaceId === "s-off")).toEqual([]);
  });

  it("fetches at most four spaces at once", async () => {
    let inFlight = 0;
    let most = 0;
    const onFetch = () => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      return () => {
        inFlight -= 1;
      };
    };
    const ids = Array.from({ length: 8 }, (_, i) => `s${String(i + 1)}`);
    const db = fakeDb({ spaces: ids.map((id) => pumpSpace({ id })) });
    const sources = Object.fromEntries(
      ids.map((id) => [id, new FakePumpSource([], { delayMs: 15, onFetch })]),
    );
    const outcomes = await harness(db, sources).run();
    expect(PUMP_CONCURRENCY).toBe(4);
    expect(outcomes).toHaveLength(8);
    expect(most).toBe(4);
  });

  it("keeps a failing space from changing the others' outcomes", async () => {
    const db = fakeDb({
      spaces: [pumpSpace({ id: "a" }), pumpSpace({ id: "b" }), pumpSpace({ id: "c" })],
    });
    const h = harness(db, {
      a: new FakePumpSource([bolus("70", ago(HOUR))]),
      b: new FakePumpSource([], { fail: true }),
      c: new FakePumpSource([bolus("71", ago(HOUR))]),
    });
    const outcomes = await h.run();
    expect(outcomes.map((o) => [o.spaceId, o.outcome, o.stored])).toEqual([
      ["a", "ok", 1],
      ["b", "failed", 0],
      ["c", "ok", 1],
    ]);
    expect(db.state.boluses.map((r) => [r.spaceId, r.sourceId])).toEqual([
      ["a", "70"],
      ["c", "71"],
    ]);
  });
});

describe("runPumpCycle: logs", () => {
  it("logs space ids and counts only over a full cycle: no address, token, units or carbs", async () => {
    const db = fakeDb({
      spaces: [
        pumpSpace({ lastPumpAt: ago(DAY) }),
        pumpSpace({ id: "s-down", lastPumpAt: ago(DAY), pumpFailures: 2 }),
      ],
    });
    const h = harness(db, {
      s1: new FakePumpSource([
        bolus("80", ago(3 * HOUR), { units: 2.37, carbs: 47 }),
        bolus("81", ago(HOUR), { units: 0.73, kind: "automatic" }),
      ]),
      "s-down": new FakePumpSource([], { fail: true }),
    });
    await h.run();
    expect(h.lines.length).toBeGreaterThan(0);
    const allowed = ["ts", "level", "msg", "spaceId", "count", "code", "ms"];
    for (const line of h.lines) {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      for (const key of Object.keys(parsed)) expect(allowed, line).toContain(key);
    }
    const output = h.lines.join("\n");
    expect(output).toContain('"spaceId":"s1"');
    expect(output).toContain('"spaceId":"s-down"');
    expect(output).not.toMatch(/2\.37|0\.73|"count":47|47g|example-ns|token|secret/);
  });
});

// The pump cycle against a real SQL Server (v0.7.0 plan §3, §5, §6): idempotent bolus storage
// under concurrent runs, one bolus per meal when a meal write races a cycle, and a pump meal that
// commits with its link and its event row or not at all, in a Serializable transaction retried
// once. Fictional people and round numbers throughout; the pump source is a fake.
// `pnpm --filter ./shared test:integration` with `DATABASE_URL`; release.yml only.
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MemoryEventSink } from "../../src/events/memory";
import { createLogger } from "../../src/log";
import { diffLinks, matchBoluses } from "../../src/pump/match";
import { runPumpCycle, type PumpSpaceOutcome } from "../../src/pump/poll-cycle";
import type { PumpDb } from "../../src/pump/store";
import type { PumpSource } from "../../src/pump/types";
import type { PumpBolus } from "../../src/schemas/pump";
import { createEmptyDatabase, migrate, type ScratchDatabase } from "./database";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const NOW = new Date("2026-10-15T18:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

let scratch: ScratchDatabase;
let db: PrismaClient;
let owner: string;
let carer: string;

beforeAll(async () => {
  scratch = await createEmptyDatabase("frejsi_pump_it");
  migrate(scratch.url);
  db = new PrismaClient({ datasourceUrl: scratch.url });
  owner = (await db.user.create({ data: { name: "Fictional owner", locale: "da" } })).id;
  carer = (await db.user.create({ data: { name: "Fictional carer" } })).id;
});
afterAll(async () => {
  await db.$disconnect();
  await scratch.drop();
});

/** A space with a connected pump record and no stored boluses yet. */
async function pumpSpace(): Promise<string> {
  const space = await db.space.create({
    data: { name: "Fictional pump room", timezone: "Europe/Copenhagen", pumpStatus: "connected" },
  });
  await db.space.update({
    where: { id: space.id },
    data: {
      pumpSource: JSON.stringify({
        type: "nightscout",
        secretRef: `pump-${space.id}/1`,
        connectedBy: owner,
      }),
      lastPumpAt: ago(HOUR),
    },
  });
  return space.id;
}

class FixedPumpSource implements PumpSource {
  constructor(private readonly records: PumpBolus[]) {}
  fetchBolusesSince(): Promise<PumpBolus[]> {
    return Promise.resolve(this.records);
  }
  probe(): Promise<"ok"> {
    return Promise.resolve("ok");
  }
}

function cycle(
  spaceId: string,
  records: PumpBolus[],
  database: PumpDb = db,
  sink = new MemoryEventSink(),
): Promise<PumpSpaceOutcome[]> {
  return runPumpCycle(
    {
      db: database,
      sources: () => new FixedPumpSource(records),
      sink,
      now: () => NOW,
      log: createLogger(() => undefined),
    },
    { spaceId },
  );
}

const bolus = (sourceId: string, ts: Date, extra: Partial<PumpBolus> = {}): PumpBolus => ({
  sourceId,
  ts: ts.toISOString(),
  units: 2.4,
  kind: "standard",
  ...extra,
});

/** The Prisma client with every transaction's options recorded and a hook into the tx. */
function wrapped(hooks: {
  beforeWork?: (attempt: number) => void;
  tx?: (tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0]) => unknown;
}) {
  const options: unknown[] = [];
  const database = {
    space: db.space,
    pumpBolus: db.pumpBolus,
    user: db.user,
    $transaction: (work: (tx: never) => Promise<unknown>, opts: Record<string, unknown>) => {
      options.push(opts);
      hooks.beforeWork?.(options.length);
      return db.$transaction(
        (tx) => work((hooks.tx ? hooks.tx(tx) : tx) as never),
        opts,
      );
    },
  } as unknown as PumpDb;
  return { database, options };
}

/**
 * What the web meal service does on a create (plan task 5), kept to its writes: the meal, the
 * matcher over its window with each linked meal's bolus, and `diffLinks`' writes, in one
 * Serializable transaction retried on a serialization failure.
 */
async function logMeal(spaceId: string, ts: Date): Promise<string> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await db.$transaction(
        async (tx) => {
          const meal = await tx.meal.create({
            data: {
              spaceId,
              ts,
              byUserId: carer,
              totalCarbs: 40,
              items: { create: [{ name: "Fictional lunch", carbs: 40, position: 0 }] },
            },
            select: { id: true },
          });
          const window = {
            gte: new Date(ts.getTime() - 2 * HOUR),
            lte: new Date(ts.getTime() + 2 * HOUR),
          };
          const boluses = await tx.pumpBolus.findMany({
            where: { spaceId, ts: window },
            select: { id: true, ts: true, kind: true },
          });
          const meals = await tx.meal.findMany({
            where: {
              spaceId,
              OR: [{ ts: window }, { pumpBolusId: { in: boluses.map((b) => b.id) } }],
            },
            select: { id: true, ts: true, source: true, pumpBolusId: true, bolusTs: true },
          });
          const current = meals.map((m) => ({
            id: m.id,
            ts: m.ts.toISOString(),
            source: m.source,
            pumpBolusId: m.pumpBolusId,
            bolusTs: m.bolusTs?.toISOString() ?? null,
          }));
          const links = matchBoluses(
            current,
            boluses.map((b) => ({
              id: b.id,
              ts: b.ts.toISOString(),
              kind: b.kind as "standard" | "extended" | "automatic" | "other",
            })),
          );
          const diff = diffLinks(current, links);
          await tx.meal.deleteMany({
            where: {
              spaceId,
              source: "pump",
              id: { in: diff.removePumpMeals.map((m) => m.mealId) },
            },
          });
          for (const link of diff.set) {
            await tx.meal.update({
              where: { id: link.mealId },
              data: { pumpBolusId: link.bolusId, bolusTs: new Date(link.bolusTs) },
            });
          }
          for (const { mealId } of diff.clear) {
            await tx.meal.update({
              where: { id: mealId },
              data: { pumpBolusId: null, bolusTs: null },
            });
          }
          return meal.id;
        },
        { isolationLevel: "Serializable", timeout: 30_000 },
      );
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if (attempt < 5 && code === "P2034") continue;
      throw error;
    }
  }
}

describe("the pump cycle on SQL Server", () => {
  it("absorbs a second concurrent insert of the same (spaceId, sourceId)", async () => {
    const spaceId = await pumpSpace();
    const records = [
      bolus("100", ago(5 * HOUR), { kind: "automatic", units: 0.6 }),
      bolus("101", ago(4 * HOUR)),
      bolus("102", ago(3 * HOUR), { kind: "extended", units: 3 }),
    ];
    const results = await Promise.all([cycle(spaceId, records), cycle(spaceId, records)]);
    const outcomes = results.flat();
    expect(outcomes.map((o) => o.outcome)).toEqual(["ok", "ok"]);
    expect(await db.pumpBolus.count({ where: { spaceId } })).toBe(3);
    expect(outcomes.reduce((sum, o) => sum + o.stored, 0)).toBe(3);
    const imported = await db.event.findMany({ where: { spaceId, type: "pump.imported" } });
    const counted = imported.reduce(
      (sum, e) => sum + (JSON.parse(e.payload) as { count: number }).count,
      0,
    );
    expect(counted).toBe(3);

    // And once more in sequence: nothing new, nothing emitted.
    const events = await db.event.count({ where: { spaceId } });
    const [again] = await cycle(spaceId, records);
    expect(again?.stored).toBe(0);
    expect(await db.event.count({ where: { spaceId } })).toBe(events);
  });

  it("never leaves one bolus linked to two meals when a meal write races a cycle", async () => {
    for (let round = 0; round < 4; round += 1) {
      const spaceId = await pumpSpace();
      const at = ago(3 * HOUR);
      const records = [bolus(`2${String(round)}0`, at, { carbs: 40 })];
      // Store the bolus first, inside its grace, so the next cycle is due to make its pump meal.
      await runPumpCycle(
        {
          db,
          sources: () => new FixedPumpSource(records),
          sink: new MemoryEventSink(),
          now: () => new Date(at.getTime() + 30 * MINUTE),
          log: createLogger(() => undefined),
        },
        { spaceId },
      );
      const [stored] = await db.pumpBolus.findMany({ where: { spaceId } });
      expect(stored).toBeDefined();
      // Started in both orders, so either side may take its locks first.
      const meal = () => logMeal(spaceId, new Date(at.getTime() + 10 * MINUTE));
      const run = () => cycle(spaceId, records);
      const [first, second] = round % 2 === 0 ? [run, meal] : [meal, run];
      await Promise.all([first(), second()]);
      const linked = await db.meal.findMany({
        where: { spaceId, pumpBolusId: stored?.id ?? "" },
        select: { id: true, source: true },
      });
      expect(linked).toHaveLength(1);
      // Whichever came first, the logged meal holds the bolus and no pump meal is left beside it.
      expect(linked[0]?.source).toBeNull();
      expect(await db.meal.count({ where: { spaceId, source: "pump" } })).toBe(0);
    }
  });

  it("commits a pump meal with its link and its event row, Serializable, as an unverified manual line", async () => {
    const spaceId = await pumpSpace();
    const { database, options } = wrapped({});
    const sink = new MemoryEventSink();
    await cycle(spaceId, [bolus("300", ago(3 * HOUR), { carbs: 45 })], database, sink);
    expect(options.length).toBeGreaterThan(0);
    for (const option of options) expect(option).toMatchObject({ isolationLevel: "Serializable" });

    const [stored] = await db.pumpBolus.findMany({ where: { spaceId } });
    const meals = await db.meal.findMany({ where: { spaceId }, include: { items: true } });
    expect(meals).toHaveLength(1);
    const [meal] = meals;
    expect(meal).toMatchObject({
      source: "pump",
      pumpBolusId: stored?.id,
      totalCarbs: 45,
      byUserId: owner,
      ts: ago(3 * HOUR),
      bolusTs: ago(3 * HOUR),
    });
    expect(meal?.items.map((i) => [i.name, i.carbs, i.foodId])).toEqual([
      ["Kulhydrater fra pumpen", 45, null],
    ]);
    const events = await db.event.findMany({ where: { spaceId }, orderBy: { seq: "asc" } });
    expect(events.map((e) => [e.type, JSON.parse(e.payload) as unknown])).toEqual([
      [
        "pump.imported",
        { count: 1, from: ago(3 * HOUR).toISOString(), to: ago(3 * HOUR).toISOString() },
      ],
      ["pump.meals", { updated: [], created: [meal?.id], removed: [] }],
    ]);
    expect(sink.published.map((p) => p.group)).toEqual([
      `space-${spaceId}-glucose`,
      `space-${spaceId}-glucose`,
    ]);
  });

  it("leaves no meal, no link and no event when the commit fails after the meal was written", async () => {
    const spaceId = await pumpSpace();
    const { database } = wrapped({
      tx: (tx) =>
        new Proxy(tx, {
          get(target, property, receiver) {
            if (property === "event") {
              return {
                create: () => Promise.reject(new Error("event write failed")),
              };
            }
            return Reflect.get(target, property, receiver) as unknown;
          },
        }),
    });
    const [outcome] = await cycle(spaceId, [bolus("400", ago(3 * HOUR), { carbs: 30 })], database);
    expect(outcome).toMatchObject({ outcome: "failed", code: "store-failed" });
    expect(await db.meal.count({ where: { spaceId } })).toBe(0);
    expect(await db.pumpBolus.count({ where: { spaceId } })).toBe(0);
    expect(await db.event.count({ where: { spaceId } })).toBe(0);
  });

  it("retries a commit once on a serialization failure", async () => {
    const spaceId = await pumpSpace();
    const { database, options } = wrapped({
      beforeWork: (attempt) => {
        if (attempt === 1) {
          throw Object.assign(new Error("Transaction failed due to a write conflict"), {
            code: "P2034",
          });
        }
      },
    });
    const [outcome] = await cycle(spaceId, [bolus("500", ago(HOUR))], database);
    expect(outcome).toMatchObject({ outcome: "ok", stored: 1 });
    expect(options).toHaveLength(2);
    expect(await db.pumpBolus.count({ where: { spaceId } })).toBe(1);
  });
});

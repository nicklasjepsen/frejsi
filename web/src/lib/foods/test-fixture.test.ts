// @vitest-environment node
import { randomUUID } from "node:crypto";
import {
  createLogger,
  type EventEnvelope,
  type FoodCandidate,
  type FoodSourceStatus,
  type SessionContext,
} from "@frejsi/shared";
import { MemoryPhotoStore } from "@frejsi/shared/photos/memory";
import { expect, it } from "vitest";
import { configureFoods, type FoodDb, type FoodDeps, type FoodTx } from "./core";

export const T0 = new Date("2026-10-15T12:00:00.000Z");
export const actor: SessionContext = {
  userId: "u1",
  name: "Example carer",
  simpleMode: false,
  accent: "olive",
  locale: "en",
  memberships: [{ spaceId: "s1", role: "carer" }],
};
export const candidate = {
  name: "Cloud pear",
  carbsPer100g: 12.5,
  portions: [],
  origin: "remote-test",
  sourceRef: "remote-test:pear",
  barcode: "2000000000015",
};
type Row = Record<string, unknown>;
const object = (value: unknown): value is Row =>
  typeof value === "object" && value !== null && !(value instanceof Date);
function matches(row: Row | undefined, where: Row = {}): boolean {
  if (!row) return false;
  return Object.entries(where).every(([key, value]) => {
    if (value === undefined) return true;
    if (key === "AND") return (value as Row[]).every((clause) => matches(row, clause));
    if (key === "OR") return (value as Row[]).some((clause) => matches(row, clause));
    if (object(value)) {
      if ("in" in value) return (value.in as unknown[]).includes(row[key]);
      if ("contains" in value) return String(row[key]).includes(String(value.contains));
      if ("gte" in value) return (row[key] as Date).getTime() >= (value.gte as Date).getTime();
      return matches(row[key] as Row, value);
    }
    return row[key] === value;
  });
}
export function foodTestRig() {
  const rig = {
    rows: [] as Row[],
    items: [] as Row[],
    events: [] as EventEnvelope[],
    published: [] as EventEnvelope[],
    sourceKind: "remote" as "remote" | "local",
    remoteCandidates: [candidate] as FoodCandidate[],
    sourceStatus: "ok" as FoodSourceStatus,
    sourcePending: false,
    failEvent: false,
    failPublish: false,
    failTransaction: false,
    deps: {} as FoodDeps,
    seed(data: Row = {}) {
      const row: Row = {
        id: randomUUID(),
        name: "Cloud pear",
        nameSearch: "cloud pear",
        spaceId: "s1",
        carbsPer100g: 12.5,
        portions: "[]",
        barcode: null,
        photoKey: null,
        origin: "family",
        sourceRef: randomUUID(),
        verified: false,
        verifiedBy: null,
        verifiedAt: null,
        favourite: false,
        createdBy: actor.userId,
        createdAt: T0,
        updatedAt: T0,
        ...data,
      };
      rig.rows.push(row);
      return row;
    },
    reset() {
      configureFoods({});
    },
  };
  let seq = 0;
  const present = (row: Row): Row => ({
    ...row,
    carbsPer100g:
      row.carbsPer100g == null
        ? null
        : { toNumber: () => Number(row.carbsPer100g), valueOf: () => Number(row.carbsPer100g) },
  });
  const find = (args: { where?: Row }) => rig.rows.filter((row) => matches(row, args.where));
  const tx = {
    food: {
      findFirst: (args: { where: Row }) => {
        const row = find(args)[0];
        return Promise.resolve(row ? present(row) : null);
      },
      findMany: (args: { where: Row; orderBy?: Row[] }) => {
        const rows = find(args);
        if (args.orderBy)
          rows.sort((a, b) => {
            for (const order of args.orderBy ?? [])
              for (const [key, dir] of Object.entries(order)) {
                const av = a[key];
                const bv = b[key];
                const cmp =
                  typeof av === "boolean"
                    ? Number(av) - Number(bv)
                    : String(av).localeCompare(String(bv));
                if (cmp) return dir === "desc" ? -cmp : cmp;
              }
            return 0;
          });
        return Promise.resolve(rows.map(present));
      },
      create: (args: { data: Row }) => {
        if (
          rig.rows.some(
            (r) => r.spaceId === args.data.spaceId && r.sourceRef === args.data.sourceRef,
          )
        )
          return Promise.reject(Object.assign(new Error("unique"), { code: "P2002" }));
        return Promise.resolve(present(rig.seed(args.data)));
      },
      update: (args: { where: Row; data: Row }) => {
        const row = find(args)[0];
        if (!row) throw new Error("missing");
        Object.assign(row, args.data, { updatedAt: T0 });
        return Promise.resolve(present(row));
      },
      delete: (args: { where: Row }) => {
        const row = find(args)[0];
        if (!row) throw new Error("missing");
        rig.rows.splice(rig.rows.indexOf(row), 1);
        for (const item of rig.items) if (item.foodId === row.id) item.foodId = null;
        return Promise.resolve(present(row));
      },
    },
    mealItem: {
      findMany: (args: { where: Row }) =>
        Promise.resolve(
          rig.items
            .filter((row) =>
              matches(
                { ...row, food: rig.rows.find((food) => food.id === row.foodId) },
                args.where,
              ),
            )
            .sort(
              (a, b) =>
                ((b.meal as Row).ts as Date).getTime() - ((a.meal as Row).ts as Date).getTime(),
            ),
        ),
    },
    space: {
      update: (args: { data: { lastSeq: { increment: number } } }) => {
        seq += args.data.lastSeq.increment;
        return Promise.resolve({ lastSeq: seq });
      },
    },
    event: {
      create: (args: { data: Row }) => {
        if (rig.failEvent) throw new Error("event write failed");
        const row = args.data;
        rig.events.push({
          ...row,
          payload: JSON.parse(String(row.payload)) as unknown,
          ts: (row.ts as Date).toISOString(),
        } as EventEnvelope);
        return Promise.resolve(row);
      },
    },
  };
  const db = {
    ...tx,
    $transaction: async <T>(run: (tx: FoodTx) => Promise<T>): Promise<T> => {
      const before = structuredClone({ rows: rig.rows, items: rig.items, events: rig.events, seq });
      try {
        if (rig.failTransaction) throw new Error("transaction failed");
        return await run(tx as unknown as FoodTx);
      } catch (error) {
        rig.rows = before.rows;
        rig.items = before.items;
        rig.events = before.events;
        seq = before.seq;
        throw error;
      }
    },
  } as unknown as FoodDb;
  rig.deps = {
    db,
    now: () => T0,
    sources: [
      {
        id: "remote-test",
        get kind() {
          return rig.sourceKind;
        },
        search: () =>
          rig.sourcePending
            ? new Promise(() => undefined)
            : Promise.resolve({ status: rig.sourceStatus, candidates: rig.remoteCandidates }),
        byBarcode: () =>
          rig.sourcePending
            ? new Promise(() => undefined)
            : Promise.resolve({ status: rig.sourceStatus, candidates: rig.remoteCandidates }),
      },
    ],
    photos: new MemoryPhotoStore(),
    log: createLogger(() => undefined),
    sink: {
      publish: (_group, event) => {
        if (rig.failPublish) throw new Error("offline");
        rig.published.push(event);
        return Promise.resolve();
      },
    },
  };
  return rig;
}
it("the database fake filters space rows and rolls back failed transactions", async () => {
  const rig = foodTestRig();
  rig.seed({ id: "a" });
  rig.seed({ id: "b", spaceId: "s2" });
  expect(await rig.deps.db?.food.findMany({ where: { spaceId: "s1" } })).toHaveLength(1);
  await expect(
    rig.deps.db?.$transaction(async (tx) => {
      await tx.food.delete({ where: { id: "a" } });
      throw new Error("rollback");
    }),
  ).rejects.toThrow("rollback");
  expect(rig.rows).toHaveLength(2);
});

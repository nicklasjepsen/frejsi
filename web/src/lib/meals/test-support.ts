// In-memory SQL delegates for meal adapter and transaction regression tests, with the pump bolus
// table (v0.7.0) so the matcher runs over the same rows the Prisma repository reads.
import type { EventEnvelope, EventSink, PrismaClient } from "@frejsi/shared";
import { PrismaMealRepository } from "./repository";
import { createMealWriter, type MealWriteDb } from "./transaction";

const at = new Date("2026-10-15T05:15:00.000Z");
interface Item {
  name: string;
  grams: number | null;
  portionLabel: string | null;
  foodId: string | null;
  carbs: number;
  position: number;
}
export interface Row {
  id: string;
  spaceId: string;
  byUserId: string;
  ts: Date;
  totalCarbs: number;
  note: string | null;
  photoKey: string | null;
  bolusTs: Date | null;
  symbol: string | null;
  pumpBolusId?: string | null;
  source?: string | null;
  items: Item[];
}
export interface BolusRow {
  id: string;
  spaceId: string;
  sourceId: string;
  ts: Date;
  units: number;
  kind: string;
  carbs: number | null;
  mealDismissed: boolean;
}
type Where = Record<string, unknown>;
/** The few Prisma filter shapes the meal and pump queries use: equality, ranges, `in`, `OR`. */
function matches(row: Record<string, unknown>, where: Where): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === "OR") return (condition as Where[]).some((part) => matches(row, part));
    const value = row[key] ?? null;
    if (condition === null || typeof condition !== "object" || condition instanceof Date)
      return condition instanceof Date
        ? value instanceof Date && +value === +condition
        : value === condition;
    const c = condition as { gte?: Date; lte?: Date; lt?: Date; gt?: Date; in?: unknown[] };
    if (c.in) return c.in.includes(value);
    if (!(value instanceof Date)) return false;
    return (
      (c.gte === undefined || +value >= +c.gte) &&
      (c.lte === undefined || +value <= +c.lte) &&
      (c.lt === undefined || +value < +c.lt) &&
      (c.gt === undefined || +value > +c.gt)
    );
  });
}
export function database() {
  const rows = new Map<string, Row>();
  const boluses = new Map<string, BolusRow>();
  const food = {
    id: "f1",
    spaceId: "s1",
    name: "Fictional toast",
    nameSearch: "fictional toast",
    origin: "family",
    sourceRef: "family:f1",
    verified: false,
    favourite: false,
    carbsPer100g: { toNumber: () => 41 },
    portions: '[{"label":"slice","grams":30,"carbs":13}]',
    createdAt: at,
    updatedAt: at,
    barcode: null,
    photoKey: null,
    verifiedBy: null,
    verifiedAt: null,
    createdBy: null,
    category: "bread",
    recipe: null,
  };
  function read(
    row: Row | undefined,
    args: { include: { items: { orderBy: { position: string } } } },
  ) {
    if (!row) return null;
    const direction = args.include.items.orderBy.position === "asc" ? 1 : -1;
    const bolus = row.pumpBolusId ? boluses.get(row.pumpBolusId) : undefined;
    return {
      ...row,
      pumpBolusId: row.pumpBolusId ?? null,
      source: row.source ?? null,
      pumpBolus: bolus
        ? { units: { toNumber: () => bolus.units }, carbs: bolus.carbs, ts: bolus.ts }
        : null,
      byUser: { id: row.byUserId, name: "Fictional carer" },
      space: { timezone: "Europe/Copenhagen" },
      items: [...row.items]
        .sort((a, b) => direction * (a.position - b.position))
        .map((item) => ({
          ...item,
          grams: item.grams === null ? null : { toNumber: () => item.grams },
        })),
    };
  }
  const plain = (row: Row) => ({
    ...row,
    pumpBolusId: row.pumpBolusId ?? null,
    source: row.source ?? null,
  });
  const db = {
    food: {
      findFirst: ({ where }: { where: { id: string; spaceId: string } }) =>
        Promise.resolve(food.id === where.id && food.spaceId === where.spaceId ? food : null),
    },
    meal: {
      create: (args: {
        data: Omit<Row, "items"> & { items: { create: Item[] } };
        include: { items: { orderBy: { position: string } } };
      }) => {
        const row = { ...args.data, items: args.data.items.create };
        rows.set(row.id, row);
        return Promise.resolve(read(row, args));
      },
      findFirst: (args: {
        where: { id: string; spaceId: string };
        include: { items: { orderBy: { position: string } } };
      }) => {
        const row = rows.get(args.where.id);
        return Promise.resolve(read(row?.spaceId === args.where.spaceId ? row : undefined, args));
      },
      findMany: ({ where }: { where: Where }) =>
        Promise.resolve([...rows.values()].map(plain).filter((row) => matches(row, where))),
      update: (args: {
        where: { id: string; spaceId: string };
        data: Partial<Omit<Row, "items" | "totalCarbs">> & {
          totalCarbs?: number | { increment: number };
          items?: { create: Item[]; deleteMany?: object };
        };
        include: { items: { orderBy: { position: string } } };
      }) => {
        const row = rows.get(args.where.id);
        if (row?.spaceId !== args.where.spaceId)
          return Promise.reject(Object.assign(new Error("missing"), { code: "P2025" }));
        const { items, ...fields } = args.data;
        const next = {
          ...row,
          ...fields,
          totalCarbs:
            typeof fields.totalCarbs === "object"
              ? row.totalCarbs + fields.totalCarbs.increment
              : (fields.totalCarbs ?? row.totalCarbs),
          items: items ? [...(items.deleteMany ? [] : row.items), ...items.create] : row.items,
        };
        rows.set(row.id, next);
        return Promise.resolve(read(next, args));
      },
      updateMany: ({ where, data }: { where: Where; data: Partial<Row> }) => {
        const hit = [...rows.values()].filter((row) => matches(plain(row), where));
        for (const row of hit) rows.set(row.id, { ...row, ...data });
        return Promise.resolve({ count: hit.length });
      },
      deleteMany: ({ where }: { where: Where }) => {
        const hit = [...rows.values()].filter((row) => matches(plain(row), where));
        for (const row of hit) rows.delete(row.id);
        return Promise.resolve({ count: hit.length });
      },
    },
    pumpBolus: {
      findMany: ({ where }: { where: Where }) =>
        Promise.resolve(
          [...boluses.values()]
            .filter((bolus) => matches({ ...bolus }, where))
            .map((bolus) => ({
              ...bolus,
              meals: [...rows.values()]
                .filter((row) => row.pumpBolusId === bolus.id)
                .map((row) => ({ id: row.id })),
            })),
        ),
      updateMany: ({ where, data }: { where: Where; data: Partial<BolusRow> }) => {
        const hit = [...boluses.values()].filter((bolus) => matches({ ...bolus }, where));
        for (const bolus of hit) boluses.set(bolus.id, { ...bolus, ...data });
        return Promise.resolve({ count: hit.length });
      },
    },
  };
  return {
    rows,
    boluses,
    food,
    db,
    repo: new PrismaMealRepository(db as unknown as Pick<PrismaClient, "meal" | "food">),
  };
}

/** A bolus row as the pump cycle stores it; fictional and round. */
export function bolus(fields: Partial<BolusRow> & { id: string; ts: Date }): BolusRow {
  return {
    spaceId: "s1",
    sourceId: `ns-${fields.id}`,
    units: 2.4,
    kind: "standard",
    carbs: null,
    mealDismissed: false,
    ...fields,
  };
}

/** A stored meal row, a person's unless `source: "pump"` says otherwise. */
export function mealRow(fields: Partial<Row> & { id: string; ts: Date }): Row {
  return {
    spaceId: "s1",
    byUserId: "u1",
    totalCarbs: 30,
    note: null,
    photoKey: null,
    bolusTs: null,
    symbol: "unknown",
    pumpBolusId: null,
    source: null,
    items: [
      { name: "Fictional meal", grams: null, portionLabel: null, foodId: null, carbs: 30, position: 0 },
    ],
    ...fields,
  };
}

/**
 * The fake database behind the real `createMealWriter`: one transaction at a time, rolled back on
 * a throw, with the isolation level each call asked for, and an optional serialization failure
 * (P2034) on the first attempt. Event rows are kept with their parsed payload.
 */
export function writerHarness(store = database()) {
  const published: { group: string; envelope: EventEnvelope }[] = [];
  const sink: EventSink & { published: typeof published } = {
    published,
    publish: (group, envelope) => {
      published.push({ group, envelope });
      return Promise.resolve();
    },
  };
  const events: { type: string; payload: unknown }[] = [];
  const isolation: unknown[] = [];
  let sequence = 0;
  let conflicts = 0;
  const sql = {
    async $transaction<T>(work: (tx: unknown) => Promise<T>, options?: unknown): Promise<T> {
      isolation.push(options);
      const before = structuredClone(store.rows);
      const beforeBoluses = structuredClone(store.boluses);
      const count = events.length;
      const tx = {
        ...store.db,
        space: { update: () => Promise.resolve({ lastSeq: ++sequence }) },
        event: {
          create: (args: { data: { type: string; payload: string } }) => {
            events.push({ type: args.data.type, payload: JSON.parse(args.data.payload) });
            return Promise.resolve(args.data);
          },
        },
      };
      try {
        const result = await work(tx);
        if (conflicts > 0) {
          conflicts--;
          throw Object.assign(new Error("Transaction failed due to a write conflict"), {
            code: "P2034",
          });
        }
        return result;
      } catch (error) {
        store.rows.clear();
        for (const [id, row] of before) store.rows.set(id, row);
        store.boluses.clear();
        for (const [id, row] of beforeBoluses) store.boluses.set(id, row);
        events.splice(count);
        throw error;
      }
    },
  };
  return {
    ...store,
    sink,
    events,
    isolation,
    conflictNext: (times = 1) => {
      conflicts = times;
    },
    write: createMealWriter(sql as unknown as MealWriteDb, sink, () => at),
  };
}

import { createEmit, type EmitFn, type EmitTx } from "../events/emit";
import type { EventSink } from "../events/types";
import { log as defaultLog, type Logger } from "../log";
import type { EventEnvelope } from "../schemas/events";
import type { SourceStatus } from "../schemas/glucose";
import type { PumpBolus } from "../schemas/pump";
import type { Locale } from "../schemas/settings";
import { AFTER_MINUTES, BEFORE_MINUTES, diffLinks, matchBoluses, type MatchMeal } from "./match";
import { pumpMealItemName } from "./messages/index";

/**
 * The pump record's writers (v0.7.0 plan §5, §6): the bolus rows, the meal links and the pump
 * meals, each commit one Serializable transaction whose events are written through
 * `createEmit(tx)` in the same transaction and published after it commits, as
 * `web/src/lib/meals/transaction.ts` does for meals. No Prisma import: the client satisfies the
 * structural types below, and tests pass a memory one.
 */

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
/** Long enough for a day of a first run's rows on Basic SQL; Prisma's default is five seconds. */
export const PUMP_TX_TIMEOUT_MS = 30_000;
export const PUMP_TX_MAX_WAIT_MS = 10_000;
/** `Meal.source` of a meal the poller made from pump carbs, until someone ticks or edits it. */
export const PUMP_MEAL_SOURCE = "pump";
/** Only a bolus a person gave for food makes a pump meal (plan decision 8). */
const MEAL_KINDS = ["standard", "extended"];
/** SQL Server takes 2100 parameters a statement: ids per `in`, and rows per `createMany`. */
const IN_BATCH = 500;
const INSERT_BATCH = 250;
/** How often the neighbourhood of a commit is widened before the matcher runs on what it has. */
const MAX_WIDENING = 8;

/** The Space columns the cycle reads. */
export interface PumpSpaceRow {
  id: string;
  pumpSource: string | null;
  pumpStatus: string;
  pumpFailures: number;
  lastPumpAt: Date | null;
}

export interface StoredBolusRow {
  id: string;
  sourceId: string;
  ts: Date;
  kind: string;
  carbs: number | null;
  mealDismissed: boolean;
}

export interface LinkedMealRow {
  id: string;
  ts: Date;
  source: string | null;
  pumpBolusId: string | null;
  bolusTs: Date | null;
}

const bolusSelect = {
  id: true,
  sourceId: true,
  ts: true,
  kind: true,
  carbs: true,
  mealDismissed: true,
} as const;
const mealSelect = { id: true, ts: true, source: true, pumpBolusId: true, bolusTs: true } as const;

export interface BolusWhere {
  spaceId: string;
  sourceId?: { in: string[] };
  id?: { in: string[] };
  ts?: { gte: Date; lte: Date };
  kind?: { in: string[] };
  carbs?: { not: null };
  mealDismissed?: boolean;
  meals?: { none: object };
}

export interface MealWhere {
  spaceId: string;
  ts?: { gte: Date; lte: Date };
  pumpBolusId?: { in: string[] };
}

export interface PumpMealData {
  spaceId: string;
  ts: Date;
  byUserId: string;
  totalCarbs: number;
  note: null;
  symbol: "unknown";
  source: typeof PUMP_MEAL_SOURCE;
  pumpBolusId: string;
  bolusTs: Date;
  items: { create: { name: string; carbs: number; position: number }[] };
}

interface BolusDelegate {
  findMany(args: { where: BolusWhere; select: typeof bolusSelect }): Promise<StoredBolusRow[]>;
}

/** The delegates a pump commit uses inside its transaction; `emit()`'s two are among them. */
export interface PumpTx extends EmitTx {
  space: EmitTx["space"] & {
    /** `lastPumpAt` forward only, decided by the database. */
    updateMany(args: {
      where: { id: string; OR: [{ lastPumpAt: null }, { lastPumpAt: { lt: Date } }] };
      data: { lastPumpAt: Date };
    }): Promise<{ count: number }>;
  };
  pumpBolus: BolusDelegate & {
    /** Rejects with `P2002` when a concurrent run stored one of the rows first. */
    createMany(args: {
      data: {
        spaceId: string;
        sourceId: string;
        ts: Date;
        units: number;
        kind: string;
        carbs: number | null;
      }[];
    }): Promise<{ count: number }>;
  };
  meal: {
    findMany(args: { where: MealWhere; select: typeof mealSelect }): Promise<LinkedMealRow[]>;
    updateMany(args: {
      where: { id: string; spaceId: string };
      data: { pumpBolusId: string | null; bolusTs: Date | null };
    }): Promise<{ count: number }>;
    create(args: { data: PumpMealData; select: { id: true } }): Promise<{ id: string }>;
    deleteMany(args: {
      where: { spaceId: string; id: { in: string[] }; source: typeof PUMP_MEAL_SOURCE };
    }): Promise<{ count: number }>;
  };
}

/** A status write: the column moves only from the status it was decided against. */
export interface StatusTx extends EmitTx {
  space: EmitTx["space"] & {
    updateMany(args: {
      where: { id: string; pumpStatus: string; pumpFailures?: number };
      data: { pumpStatus: string; pumpFailures?: number };
    }): Promise<{ count: number }>;
  };
}

/** The database the cycle runs on; the Prisma client satisfies it. */
export interface PumpDb {
  space: {
    findMany(args: {
      where: { pumpSource: { not: null }; id?: string };
      select: {
        id: true;
        pumpSource: true;
        pumpStatus: true;
        pumpFailures: true;
        lastPumpAt: true;
      };
    }): Promise<PumpSpaceRow[]>;
    /** The failure counter is incremented in the database, never computed from a snapshot. */
    update(args: {
      where: { id: string };
      data: { pumpFailures: { increment: number } };
      select: { pumpFailures: true; pumpStatus: true };
    }): Promise<{ pumpFailures: number; pumpStatus: string }>;
  };
  pumpBolus: BolusDelegate;
  user: {
    findUnique(args: {
      where: { id: string };
      select: { locale: true };
    }): Promise<{ locale: string } | null>;
  };
  $transaction<T>(
    work: (tx: PumpTx & StatusTx) => Promise<T>,
    options: { isolationLevel: "Serializable"; timeout: number; maxWait: number },
  ): Promise<T>;
}

export type PumpWriter = <T>(
  work: (tx: PumpTx & StatusTx, emit: EmitFn) => Promise<T>,
) => Promise<T>;

export interface PumpWriterDeps {
  db: Pick<PumpDb, "$transaction">;
  sink: EventSink;
  now?: () => Date;
  log?: Logger;
}

const codeOf = (error: unknown): unknown =>
  typeof error === "object" && error !== null && "code" in error ? error.code : undefined;

/**
 * A serialization failure (`P2034`: SQL Server chose this transaction as a deadlock victim or saw
 * a write conflict), or a unique violation from a concurrent run that stored the same bolus first
 * (`P2002`). Both are settled by running the commit once more on the rows as they are now.
 */
const isRetryable = (error: unknown): boolean => {
  const code = codeOf(error);
  return code === "P2034" || code === "P2002";
};

/**
 * Runs `work` in one Serializable transaction with an explicit timeout, retried once on a
 * serialization failure; the events `work` emits are written in the transaction and published
 * only after it commits, so a rolled-back attempt tells no client anything.
 */
export function createPumpWriter(deps: PumpWriterDeps): PumpWriter {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? defaultLog;
  return async (work) => {
    let pending: { group: string; envelope: EventEnvelope }[] = [];
    const attempt = () => {
      pending = [];
      return deps.db.$transaction(
        (tx) => {
          const emit = createEmit({
            db: { $transaction: (callback) => callback(tx) },
            sink: {
              publish: (group, envelope) => {
                pending.push({ group, envelope });
                return Promise.resolve();
              },
            },
            now,
          });
          return work(tx, emit);
        },
        {
          isolationLevel: "Serializable",
          timeout: PUMP_TX_TIMEOUT_MS,
          maxWait: PUMP_TX_MAX_WAIT_MS,
        },
      );
    };
    let result: Awaited<ReturnType<typeof work>>;
    try {
      result = await attempt();
    } catch (error) {
      if (!isRetryable(error)) throw error;
      result = await attempt();
    }
    for (const { group, envelope } of pending) {
      try {
        await deps.sink.publish(group, envelope);
      } catch {
        // The row is committed; clients catch up through /events?since.
        log.warn("event.publish-failed", { spaceId: envelope.spaceId, code: "publish-failed" });
      }
    }
    return result;
  };
}

/** The connecting owner: who a pump meal is by, and the language its one line is named in. */
export interface PumpMealOwner {
  userId: string;
  locale: Locale;
}

/**
 * A meal made from a bolus's carbs (plan §6): at the bolus's time, by the connecting owner, one
 * manual line named in their locale with no linked food, `source: "pump"` (unverified until a
 * carer ticks or edits it), linked to the bolus it came from.
 */
export function pumpMealData(
  spaceId: string,
  bolus: { id: string; ts: Date; carbs: number },
  owner: PumpMealOwner,
): PumpMealData {
  return {
    spaceId,
    ts: bolus.ts,
    byUserId: owner.userId,
    totalCarbs: bolus.carbs,
    note: null,
    symbol: "unknown",
    source: PUMP_MEAL_SOURCE,
    pumpBolusId: bolus.id,
    bolusTs: bolus.ts,
    items: { create: [{ name: pumpMealItemName(owner.locale), carbs: bolus.carbs, position: 0 }] },
  };
}

/** Consecutive 24-hour slices from the oldest record, oldest first: one commit each. */
export function splitByDay<T extends { ts: string }>(records: readonly T[]): T[][] {
  const sorted = [...records].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  const days: T[][] = [];
  let start = Number.NEGATIVE_INFINITY;
  for (const record of sorted) {
    const t = Date.parse(record.ts);
    const day = days.at(-1);
    if (day === undefined || t - start >= DAY) {
      days.push([record]);
      start = t;
    } else {
      day.push(record);
    }
  }
  return days;
}

function batches<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < items.length; start += size)
    out.push(items.slice(start, start + size));
  return out;
}

/** The stored rows among `sourceIds`, read in batches. */
export async function findStoredBoluses(
  db: BolusDelegate,
  spaceId: string,
  sourceIds: readonly string[],
): Promise<StoredBolusRow[]> {
  const rows: StoredBolusRow[] = [];
  for (const batch of batches(sourceIds, IN_BATCH)) {
    rows.push(
      ...(await db.findMany({ where: { spaceId, sourceId: { in: batch } }, select: bolusSelect })),
    );
  }
  return rows;
}

/** The boluses a pump meal is due for: a person's bolus with carbs, past the grace, unclaimed. */
function dueWhere(spaceId: string, from: Date, before: Date): BolusWhere {
  return {
    spaceId,
    ts: { gte: from, lte: before },
    kind: { in: MEAL_KINDS },
    carbs: { not: null },
    mealDismissed: false,
    meals: { none: {} },
  };
}

/** Whether any bolus waits for its pump meal; read outside a transaction, so a quiet cycle opens none. */
export async function hasDueBoluses(
  db: BolusDelegate,
  spaceId: string,
  from: Date,
  before: Date,
): Promise<boolean> {
  if (from.getTime() > before.getTime()) return false;
  const rows = await db.findMany({ where: dueWhere(spaceId, from, before), select: bolusSelect });
  return rows.length > 0;
}

export interface ImportTotals {
  count: number;
  from: string | undefined;
  to: string | undefined;
}

export interface PumpDayInput {
  spaceId: string;
  /** The records of this slice the space may not have yet; re-checked inside the transaction. */
  boluses: readonly PumpBolus[];
  /** Pump meals are made for boluses from `dueFrom` (the cycle's window) up to `dueBefore`. */
  dueFrom: Date;
  dueBefore: Date;
  /** Null when the connecting owner is gone: links still change, no pump meal is made. */
  owner: PumpMealOwner | null;
  /**
   * The cycle's last commit: it also looks for every bolus still waiting for its pump meal, and
   * emits `pump.imported` with the cycle's totals (`before` plus this commit's rows).
   */
  last?: { before: ImportTotals };
}

export interface PumpDayResult {
  inserted: number;
  from: string | undefined;
  to: string | undefined;
  updated: string[];
  created: string[];
  removed: string[];
  /** Whether this commit emitted the cycle's `pump.imported`. */
  announced: boolean;
}

const minTime = (a: string | undefined, b: string | undefined) =>
  a === undefined ? b : b === undefined ? a : Date.parse(a) <= Date.parse(b) ? a : b;
const maxTime = (a: string | undefined, b: string | undefined) =>
  a === undefined ? b : b === undefined ? a : Date.parse(a) >= Date.parse(b) ? a : b;

/** Adds this slice's new rows; a row a concurrent run stored first fails the commit with `P2002`. */
async function insertNew(
  tx: PumpTx,
  spaceId: string,
  boluses: readonly PumpBolus[],
): Promise<PumpBolus[]> {
  if (boluses.length === 0) return [];
  const stored = new Set(
    (
      await findStoredBoluses(
        tx.pumpBolus,
        spaceId,
        boluses.map((b) => b.sourceId),
      )
    ).map((row) => row.sourceId),
  );
  const fresh = boluses.filter((bolus) => !stored.has(bolus.sourceId));
  for (const batch of batches(fresh, INSERT_BATCH)) {
    await tx.pumpBolus.createMany({
      data: batch.map((bolus) => ({
        spaceId,
        sourceId: bolus.sourceId,
        ts: new Date(bolus.ts),
        units: bolus.units,
        kind: bolus.kind,
        carbs: bolus.carbs ?? null,
      })),
    });
  }
  return fresh;
}

interface Neighbourhood {
  boluses: Map<string, StoredBolusRow>;
  meals: Map<string, LinkedMealRow>;
}

/**
 * Everything the matcher must see to judge the boluses in `[from, to]` without breaking a link it
 * was not shown: the meals that could pair with them, the boluses those meals could pair with,
 * widened until nothing new comes in (a chain of meals and boluses closer than the window), then
 * every meal linked to one of those boluses and every bolus linked to one of those meals.
 */
async function loadNeighbourhood(
  tx: PumpTx,
  spaceId: string,
  from: number,
  to: number,
): Promise<Neighbourhood> {
  const boluses = new Map<string, StoredBolusRow>();
  const meals = new Map<string, LinkedMealRow>();
  let lo = from;
  let hi = to;
  for (let round = 0; round < MAX_WIDENING; round += 1) {
    for (const row of await tx.pumpBolus.findMany({
      where: { spaceId, ts: { gte: new Date(lo), lte: new Date(hi) } },
      select: bolusSelect,
    }))
      boluses.set(row.id, row);
    // A meal pairs with a bolus from 45 minutes before the meal to 30 after it.
    const mealRows = await tx.meal.findMany({
      where: {
        spaceId,
        ts: {
          gte: new Date(lo - AFTER_MINUTES * MINUTE),
          lte: new Date(hi + BEFORE_MINUTES * MINUTE),
        },
      },
      select: mealSelect,
    });
    for (const row of mealRows) meals.set(row.id, row);
    const times = mealRows.map((row) => row.ts.getTime());
    const nextLo = Math.min(lo, ...times.map((t) => t - BEFORE_MINUTES * MINUTE));
    const nextHi = Math.max(hi, ...times.map((t) => t + AFTER_MINUTES * MINUTE));
    if (nextLo === lo && nextHi === hi) break;
    lo = nextLo;
    hi = nextHi;
  }
  for (const batch of batches([...boluses.keys()], IN_BATCH)) {
    for (const row of await tx.meal.findMany({
      where: { spaceId, pumpBolusId: { in: batch } },
      select: mealSelect,
    }))
      meals.set(row.id, row);
  }
  const unseen = [...meals.values()]
    .map((meal) => meal.pumpBolusId)
    .filter((id): id is string => id !== null && !boluses.has(id));
  for (const batch of batches([...new Set(unseen)], IN_BATCH)) {
    for (const row of await tx.pumpBolus.findMany({
      where: { spaceId, id: { in: batch } },
      select: bolusSelect,
    }))
      boluses.set(row.id, row);
  }
  return { boluses, meals };
}

const toMatchMeal = (meal: LinkedMealRow): MatchMeal => ({
  id: meal.id,
  ts: meal.ts.toISOString(),
  source: meal.source,
  pumpBolusId: meal.pumpBolusId,
  bolusTs: meal.bolusTs?.toISOString() ?? null,
});

const asKind = (kind: string) =>
  kind === "standard" || kind === "extended" || kind === "automatic" ? kind : "other";

/**
 * One commit of the pump cycle (plan §5, §6), in the writer's transaction: the new boluses of one
 * slice, the matcher over their neighbourhood with only `diffLinks`' differences written, the
 * pump meals that are due, `lastPumpAt` forward, and the events: `pump.meals` for every meal this
 * commit changed, and on the last commit the cycle's `pump.imported`. A link change is never a
 * `meal.updated`, and a pump meal never a `meal.created`: both would reach a viewer.
 */
export async function commitPumpDay(
  tx: PumpTx,
  emit: EmitFn,
  input: PumpDayInput,
): Promise<PumpDayResult> {
  const { spaceId } = input;
  const fresh = await insertNew(tx, spaceId, input.boluses);
  const times = fresh.map((bolus) => bolus.ts);
  const from = times.reduce<string | undefined>(minTime, undefined);
  const to = times.reduce<string | undefined>(maxTime, undefined);

  // The span to judge: this slice, and on the last commit every bolus still waiting for a meal.
  const span = input.boluses.map((bolus) => Date.parse(bolus.ts));
  if (input.last && input.dueFrom.getTime() <= input.dueBefore.getTime()) {
    const due = await tx.pumpBolus.findMany({
      where: dueWhere(spaceId, input.dueFrom, input.dueBefore),
      select: bolusSelect,
    });
    span.push(...due.map((row) => row.ts.getTime()));
  }

  const updated: string[] = [];
  const created: string[] = [];
  const removed: string[] = [];
  if (span.length > 0) {
    const area = await loadNeighbourhood(tx, spaceId, Math.min(...span), Math.max(...span));
    const current = [...area.meals.values()].map(toMatchMeal);
    const links = matchBoluses(
      current,
      [...area.boluses.values()].map((row) => ({
        id: row.id,
        ts: row.ts.toISOString(),
        kind: asKind(row.kind),
      })),
    );
    const diff = diffLinks(current, links);
    if (diff.removePumpMeals.length > 0) {
      const ids = diff.removePumpMeals.map((meal) => meal.mealId);
      await tx.meal.deleteMany({
        where: { spaceId, id: { in: ids }, source: PUMP_MEAL_SOURCE },
      });
      removed.push(...ids);
    }
    for (const link of diff.set) {
      await tx.meal.updateMany({
        where: { id: link.mealId, spaceId },
        data: { pumpBolusId: link.bolusId, bolusTs: new Date(link.bolusTs) },
      });
      updated.push(link.mealId);
    }
    for (const { mealId } of diff.clear) {
      await tx.meal.updateMany({
        where: { id: mealId, spaceId },
        data: { pumpBolusId: null, bolusTs: null },
      });
      updated.push(mealId);
    }

    if (input.owner !== null) {
      const claimed = new Set(links.map((link) => link.bolusId));
      const due = [...area.boluses.values()]
        .filter(
          (row) =>
            MEAL_KINDS.includes(row.kind) &&
            row.carbs !== null &&
            !row.mealDismissed &&
            !claimed.has(row.id) &&
            row.ts.getTime() >= input.dueFrom.getTime() &&
            row.ts.getTime() <= input.dueBefore.getTime(),
        )
        .sort((a, b) => a.ts.getTime() - b.ts.getTime());
      for (const row of due) {
        const meal = await tx.meal.create({
          data: pumpMealData(
            spaceId,
            { id: row.id, ts: row.ts, carbs: row.carbs ?? 0 },
            input.owner,
          ),
          select: { id: true },
        });
        created.push(meal.id);
      }
    }
  }

  if (to !== undefined) {
    const newest = new Date(to);
    await tx.space.updateMany({
      where: { id: spaceId, OR: [{ lastPumpAt: null }, { lastPumpAt: { lt: newest } }] },
      data: { lastPumpAt: newest },
    });
  }

  let announced = false;
  if (input.last) {
    const count = input.last.before.count + fresh.length;
    const rangeFrom = minTime(input.last.before.from, from);
    const rangeTo = maxTime(input.last.before.to, to);
    if (count > 0 && rangeFrom !== undefined && rangeTo !== undefined) {
      await emit(spaceId, "pump.imported", { count, from: rangeFrom, to: rangeTo });
      announced = true;
    }
  }
  const updatedOnce = [...new Set(updated)];
  if (updatedOnce.length + created.length + removed.length > 0) {
    await emit(spaceId, "pump.meals", { updated: updatedOnce, created, removed });
  }
  return { inserted: fresh.length, from, to, updated: updatedOnce, created, removed, announced };
}

/**
 * The status change, its event and the column in one commit; nothing when the row moved meanwhile
 * (another cycle changed the status, or, with `failures`, a success reset the counter).
 */
export async function writePumpStatus(
  tx: StatusTx,
  emit: EmitFn,
  input: {
    spaceId: string;
    from: string;
    to: SourceStatus;
    resetFailures?: boolean;
    /** The failure count the decision was taken on; the row must still hold it. */
    failures?: number;
    since: Date;
  },
): Promise<boolean> {
  const { count } = await tx.space.updateMany({
    where: {
      id: input.spaceId,
      pumpStatus: input.from,
      ...(input.failures === undefined ? {} : { pumpFailures: input.failures }),
    },
    data: { pumpStatus: input.to, ...(input.resetFailures ? { pumpFailures: 0 } : {}) },
  });
  if (count !== 1) return false;
  if (input.from !== input.to) {
    await emit(input.spaceId, "pump.status", {
      status: input.to,
      since: input.since.toISOString(),
    });
  }
  return true;
}

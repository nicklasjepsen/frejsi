import type { EmitFn } from "../../events/emit";
import type { Reading } from "../../schemas/glucose";

/** The Prisma delegates the import writes through; the real client satisfies it, tests pass a memory one. */
export interface ImportDb {
  reading: {
    findMany(args: {
      where: { spaceId: string; ts: { gte: Date; lte: Date } };
      select: { ts: true };
    }): Promise<{ ts: Date }[]>;
    createMany(args: {
      data: { spaceId: string; ts: Date; mmol: number; trend: string; source: string }[];
    }): Promise<{ count: number }>;
  };
  space: {
    /** Forward only, decided by the database, as the poll cycle moves it. */
    updateMany(args: {
      where: { id: string; OR: [{ lastReadingAt: null }, { lastReadingAt: { lt: Date } }] };
      data: { lastReadingAt: Date };
    }): Promise<{ count: number }>;
  };
}

export interface StoreImportDeps {
  db: ImportDb;
  emit: EmitFn;
  /** The `source` column of every stored row, e.g. `import:clarity`. */
  source: string;
}

export interface StoredImport {
  added: number;
  skipped: number;
  from: string | null;
  to: string | null;
}

/**
 * A reading within this of a stored one is the same reading: Share's wall time and Clarity's
 * display time come from the same device clock, but not always to the same second.
 */
export const IMPORT_TOLERANCE_MS = 60_000;
/** Rows per `createMany`: five columns each, well under SQL Server's 2100 parameters a statement. */
export const IMPORT_BATCH = 400;

/** Prisma's unique-constraint violation, matched by code so this module needs no Prisma import. */
const isUniqueViolation = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === "P2002";

/** True when a time in `sorted` lies within the tolerance of `t`. */
function near(sorted: number[], t: number): boolean {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((sorted[middle] ?? Number.POSITIVE_INFINITY) < t) low = middle + 1;
    else high = middle;
  }
  const after = sorted[low];
  const before = sorted[low - 1];
  return (
    (after !== undefined && after - t < IMPORT_TOLERANCE_MS) ||
    (before !== undefined && t - before < IMPORT_TOLERANCE_MS)
  );
}

async function existingBetween(db: ImportDb, spaceId: string, from: number, to: number) {
  const rows = await db.reading.findMany({
    where: {
      spaceId,
      ts: { gte: new Date(from - IMPORT_TOLERANCE_MS), lte: new Date(to + IMPORT_TOLERANCE_MS) },
    },
    select: { ts: true },
  });
  return rows.map((r) => r.ts.getTime()).sort((a, b) => a - b);
}

/**
 * Stores the readings the space does not have yet, in batches, and emits one `readings.imported`
 * for the lot: the same idempotent outcome as the poll cycle (a reading is stored once, whoever
 * delivers it first), without an event per row. Re-importing the same file adds nothing.
 */
export async function storeImportedReadings(
  deps: StoreImportDeps,
  spaceId: string,
  readings: Reading[],
): Promise<StoredImport> {
  if (readings.length === 0) return { added: 0, skipped: 0, from: null, to: null };
  const sorted = [...readings].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  const first = Date.parse(sorted[0]?.ts ?? "");
  const last = Date.parse(sorted.at(-1)?.ts ?? "");
  const existing = await existingBetween(deps.db, spaceId, first, last);

  const fresh: Reading[] = [];
  let previous = Number.NEGATIVE_INFINITY;
  for (const reading of sorted) {
    const t = Date.parse(reading.ts);
    if (near(existing, t) || t - previous < IMPORT_TOLERANCE_MS) continue;
    fresh.push(reading);
    previous = t;
  }

  let added = 0;
  for (let start = 0; start < fresh.length; start += IMPORT_BATCH) {
    const batch = fresh.slice(start, start + IMPORT_BATCH);
    added += await insert(deps, spaceId, batch);
  }

  if (added > 0) {
    const latest = new Date(Date.parse(fresh.at(-1)?.ts ?? ""));
    await deps.db.space.updateMany({
      where: { id: spaceId, OR: [{ lastReadingAt: null }, { lastReadingAt: { lt: latest } }] },
      data: { lastReadingAt: latest },
    });
    await deps.emit(spaceId, "readings.imported", {
      count: added,
      from: fresh[0]?.ts ?? "",
      to: fresh.at(-1)?.ts ?? "",
    });
  }

  return {
    added,
    skipped: readings.length - added,
    from: sorted[0]?.ts ?? null,
    to: sorted.at(-1)?.ts ?? null,
  };
}

const rowsOf = (spaceId: string, source: string, batch: Reading[]) =>
  batch.map((r) => ({ spaceId, ts: new Date(r.ts), mmol: r.mmol, trend: r.trend, source }));

/**
 * One batch; when the poller stored one of its instants between the check and the insert, the
 * batch is checked again against the rows as they are now and inserted without them.
 */
async function insert(deps: StoreImportDeps, spaceId: string, batch: Reading[]): Promise<number> {
  try {
    const { count } = await deps.db.reading.createMany({
      data: rowsOf(spaceId, deps.source, batch),
    });
    return count;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }
  const first = Date.parse(batch[0]?.ts ?? "");
  const last = Date.parse(batch.at(-1)?.ts ?? "");
  const existing = await existingBetween(deps.db, spaceId, first, last);
  const remaining = batch.filter((r) => !near(existing, Date.parse(r.ts)));
  if (remaining.length === 0) return 0;
  const { count } = await deps.db.reading.createMany({
    data: rowsOf(spaceId, deps.source, remaining),
  });
  return count;
}

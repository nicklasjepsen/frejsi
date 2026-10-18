import { createEventSinkFromEnv } from "../events/pubsub";
import type { EventSink } from "../events/types";
import { log as defaultLog, type Logger } from "../log";
import type { SourceStatus } from "../schemas/glucose";
import { PumpBolus, PumpSourceConfig } from "../schemas/pump";
import { localeOrDefault } from "../schemas/settings";
import {
  commitPumpDay,
  createPumpWriter,
  findStoredBoluses,
  hasDueBoluses,
  splitByDay,
  writePumpStatus,
  type ImportTotals,
  type PumpDb,
  type PumpMealOwner,
  type PumpSpaceRow,
  type PumpWriter,
} from "./store";
import type { PumpSource } from "./types";

/**
 * The pump cycle (v0.7.0 plan §5, §6), pure like the glucose one: no Azure, no Prisma client of
 * its own. The `pump-poll` timer hands it a database, an event sink and a source factory. It
 * knows `PumpSource`, never an adapter.
 */
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** A first run reads two weeks (plan §5); no window is ever longer. */
export const PUMP_FIRST_RUN_DAYS = 14;
/** Every cycle reads at least the last day: Tandem's upload lags and can arrive in a burst. */
export const PUMP_WINDOW_HOURS = 24;
/** And three hours behind the newest stored bolus, so a late record is never skipped. */
export const PUMP_OVERLAP_HOURS = 3;
/** A carb bolus with no meal gets a pump meal once it is this old (plan §6, decision 6). */
export const PUMP_MEAL_GRACE_MINUTES = 120;
/** Three consecutive failures mark the pump record disconnected, as for a glucose source. */
export const PUMP_FAILURES_BEFORE_DISCONNECTED = 3;
/** Spaces read side by side, so a few stalled sites cannot hold the rest until the host's timeout. */
export const PUMP_CONCURRENCY = 4;

/** `since = max(now − 14 d, min(now − 24 h, lastPumpAt − 3 h))`; a first run reads the 14 days. */
export function pumpSinceFor(lastPumpAt: Date | null, now: Date): Date {
  const floor = now.getTime() - PUMP_FIRST_RUN_DAYS * DAY;
  if (lastPumpAt === null) return new Date(floor);
  const window = now.getTime() - PUMP_WINDOW_HOURS * HOUR;
  const overlap = lastPumpAt.getTime() - PUMP_OVERLAP_HOURS * HOUR;
  return new Date(Math.max(floor, Math.min(window, overlap)));
}

/** Builds the source for a space from its config; it throws when the credential cannot be read. */
export type PumpSourceFactory = (
  space: PumpSpaceRow,
  config: PumpSourceConfig,
) => PumpSource | Promise<PumpSource>;

export interface PumpCycleDeps {
  db: PumpDb;
  sources: PumpSourceFactory;
  /** Defaults to Web PubSub from the environment; tests and the CLI pass a memory sink. */
  sink?: EventSink;
  now?: () => Date;
  log?: Logger;
}

export interface PumpCycleOptions {
  /** This space only. */
  spaceId?: string;
}

export type PumpOutcomeCode =
  | "ok"
  | "config-invalid"
  | "source-unavailable"
  | "fetch-failed"
  | "store-failed"
  | "status-update-failed";

export interface PumpSpaceOutcome {
  spaceId: string;
  outcome: "ok" | "failed";
  code: PumpOutcomeCode;
  /** New bolus rows this cycle. */
  stored: number;
  /** Pump meals made this cycle. */
  mealsCreated: number;
  status: SourceStatus;
}

class CycleError extends Error {
  constructor(
    readonly code: PumpOutcomeCode,
    cause: unknown,
  ) {
    super(code, { cause });
    this.name = "CycleError";
  }
}

const codeOf = (error: unknown): string => {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = error.code;
    if (typeof code === "string") return code;
  }
  return error instanceof Error ? error.name : "unknown";
};

/**
 * One cycle over every space with a pump source, four at a time. Each space runs in its own
 * try/catch: one failure never stops or changes the others. One outcome per space, in order.
 */
export async function runPumpCycle(
  deps: PumpCycleDeps,
  options: PumpCycleOptions = {},
): Promise<PumpSpaceOutcome[]> {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? defaultLog;
  const sink = deps.sink ?? createEventSinkFromEnv();
  const spaces = await deps.db.space.findMany({
    where: { pumpSource: { not: null }, ...(options.spaceId ? { id: options.spaceId } : {}) },
    select: { id: true, pumpSource: true, pumpStatus: true, pumpFailures: true, lastPumpAt: true },
  });
  const resolved: Resolved = {
    db: deps.db,
    sources: deps.sources,
    now,
    log,
    write: createPumpWriter({ db: deps.db, sink, now, log }),
  };
  return mapBounded(spaces, PUMP_CONCURRENCY, (space) => pollSpace(space, resolved));
}

interface Resolved {
  db: PumpDb;
  sources: PumpSourceFactory;
  now: () => Date;
  log: Logger;
  write: PumpWriter;
}

/** `Promise.all` with at most `limit` in flight; results in input order. */
async function mapBounded<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function parseConfig(raw: string | null): PumpSourceConfig {
  try {
    return PumpSourceConfig.parse(JSON.parse(raw ?? "null"));
  } catch (error) {
    throw new CycleError("config-invalid", error);
  }
}

/** Only well-formed records reach the store, whatever the source returned. */
function validRecords(records: readonly unknown[], since: Date): PumpBolus[] {
  const out: PumpBolus[] = [];
  for (const record of records) {
    const parsed = PumpBolus.safeParse(record);
    if (parsed.success && Date.parse(parsed.data.ts) >= since.getTime()) out.push(parsed.data);
  }
  return out;
}

async function pollSpace(space: PumpSpaceRow, deps: Resolved): Promise<PumpSpaceOutcome> {
  const started = deps.now();
  const spaceId = space.id;
  let stored = 0;
  let mealsCreated = 0;
  try {
    const config = parseConfig(space.pumpSource);
    let source: PumpSource;
    try {
      source = await deps.sources(space, config);
    } catch (error) {
      throw new CycleError("source-unavailable", error);
    }
    const since = pumpSinceFor(space.lastPumpAt, started);
    let records: PumpBolus[];
    try {
      records = validRecords(await source.fetchBolusesSince(since), since);
    } catch (error) {
      throw new CycleError("fetch-failed", error);
    }

    try {
      const result = await store(space, config, records, since, deps);
      stored = result.stored;
      mealsCreated = result.mealsCreated;
    } catch (error) {
      if (error instanceof CycleError) throw error;
      throw new CycleError("store-failed", error);
    }

    let status: SourceStatus;
    try {
      status = await markConnected(space, deps);
    } catch (error) {
      throw new CycleError("status-update-failed", error);
    }
    deps.log.info("pump.space", {
      spaceId,
      count: stored,
      code: "ok",
      ms: deps.now().getTime() - started.getTime(),
    });
    return { spaceId, outcome: "ok", code: "ok", stored, mealsCreated, status };
  } catch (error) {
    const code = error instanceof CycleError ? error.code : "fetch-failed";
    const cause = error instanceof CycleError ? error.cause : error;
    deps.log.warn("pump.space-failed", {
      spaceId,
      count: stored,
      code: `${code}:${codeOf(cause)}`,
    });
    // Only the source's own faults count towards "disconnected"; a database failure after a good
    // fetch says nothing about the site.
    const sourceFault =
      code === "config-invalid" || code === "source-unavailable" || code === "fetch-failed";
    const status = sourceFault ? await markFailed(space, deps) : (space.pumpStatus as SourceStatus);
    return { spaceId, outcome: "failed", code, stored, mealsCreated, status };
  }
}

/** The connecting owner and their language, or null when they are no longer a user. */
async function ownerOf(
  config: PumpSourceConfig,
  spaceId: string,
  deps: Resolved,
): Promise<PumpMealOwner | null> {
  const user = await deps.db.user.findUnique({
    where: { id: config.connectedBy },
    select: { locale: true },
  });
  if (user === null) {
    deps.log.warn("pump.meals-skipped", { spaceId, code: "owner-missing" });
    return null;
  }
  return { userId: config.connectedBy, locale: localeOrDefault(user.locale) };
}

/**
 * Stores what is new, one commit per day of records, and makes the pump meals that are due. The
 * last commit carries the cycle's `pump.imported`; when a later commit fails after earlier ones
 * landed, the announcement is made on its own so the clients still hear of the stored rows.
 */
async function store(
  space: PumpSpaceRow,
  config: PumpSourceConfig,
  records: PumpBolus[],
  since: Date,
  deps: Resolved,
): Promise<{ stored: number; mealsCreated: number }> {
  const spaceId = space.id;
  const now = deps.now();
  const dueBefore = new Date(now.getTime() - PUMP_MEAL_GRACE_MINUTES * MINUTE);
  const known = new Set(
    (
      await findStoredBoluses(
        deps.db.pumpBolus,
        spaceId,
        records.map((r) => r.sourceId),
      )
    ).map((row) => row.sourceId),
  );
  const days = splitByDay(records.filter((record) => !known.has(record.sourceId)));
  if (days.length === 0) {
    if (!(await hasDueBoluses(deps.db.pumpBolus, spaceId, since, dueBefore))) {
      return { stored: 0, mealsCreated: 0 };
    }
    days.push([]);
  }

  const owner = await ownerOf(config, spaceId, deps);
  const totals: ImportTotals = { count: 0, from: undefined, to: undefined };
  let mealsCreated = 0;
  try {
    for (const [index, boluses] of days.entries()) {
      const last = index === days.length - 1;
      const result = await deps.write((tx, emit) =>
        commitPumpDay(tx, emit, {
          spaceId,
          boluses,
          dueFrom: since,
          dueBefore,
          owner,
          ...(last ? { last: { before: { ...totals } } } : {}),
        }),
      );
      totals.count += result.inserted;
      totals.from ??= result.from;
      totals.to = result.to ?? totals.to;
      mealsCreated += result.created.length;
    }
  } catch (error) {
    if (totals.count > 0) await announce(spaceId, totals, deps);
    throw new CycleError("store-failed", error);
  }
  return { stored: totals.count, mealsCreated };
}

/** The cycle's `pump.imported` for rows earlier commits stored, when the last commit failed. */
async function announce(spaceId: string, totals: ImportTotals, deps: Resolved): Promise<void> {
  const { from, to, count } = totals;
  if (from === undefined || to === undefined) return;
  try {
    await deps.write((_tx, emit) => emit(spaceId, "pump.imported", { count, from, to }));
  } catch (error) {
    deps.log.error("pump.announce-failed", { spaceId, code: codeOf(error) }, error);
  }
}

/** A success resets the counter and, when the record was disconnected, says it is connected again. */
async function markConnected(space: PumpSpaceRow, deps: Resolved): Promise<SourceStatus> {
  if (space.pumpStatus === "connected" && space.pumpFailures === 0) return "connected";
  // The snapshot is from before the fetch; a concurrent cycle may have disconnected the space
  // since. The transaction is Serializable, so the status read here is the one the write moves from.
  await deps.write(async (tx, emit) => {
    const current = await tx.space.findUnique({
      where: { id: space.id },
      select: { pumpStatus: true },
    });
    if (!current) return false;
    return writePumpStatus(tx, emit, {
      spaceId: space.id,
      from: current.pumpStatus,
      to: "connected",
      resetFailures: true,
      since: deps.now(),
    });
  });
  return "connected";
}

/**
 * Counts the failure in the database (an atomic increment, so overlapping cycles count two) and,
 * when the fresh count reaches the limit, flips the column and emits `pump.status` in one commit.
 */
async function markFailed(space: PumpSpaceRow, deps: Resolved): Promise<SourceStatus> {
  try {
    const row = await deps.db.space.update({
      where: { id: space.id },
      data: { pumpFailures: { increment: 1 } },
      select: { pumpFailures: true, pumpStatus: true },
    });
    const disconnect =
      row.pumpFailures >= PUMP_FAILURES_BEFORE_DISCONNECTED && row.pumpStatus !== "disconnected";
    if (!disconnect) return row.pumpStatus as SourceStatus;
    const changed = await deps.write((tx, emit) =>
      writePumpStatus(tx, emit, {
        spaceId: space.id,
        from: row.pumpStatus,
        to: "disconnected",
        // A success that reset the counter after this increment is fresher and stays.
        failures: row.pumpFailures,
        since: deps.now(),
      }),
    );
    return changed ? "disconnected" : (row.pumpStatus as SourceStatus);
  } catch (error) {
    deps.log.error("pump.status-update-failed", { spaceId: space.id, code: codeOf(error) }, error);
    return space.pumpStatus as SourceStatus;
  }
}

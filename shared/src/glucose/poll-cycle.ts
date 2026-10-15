import { emit as defaultEmit, type EmitFn } from "../events/emit";
import { log as defaultLog, type Logger } from "../log";
import { GlucoseSourceConfig, Reading, type SourceStatus } from "../schemas/glucose";
import type { GlucoseSource } from "./types";

/**
 * The poll cycle (spec §3), pure: no Azure, no Prisma client of its own. The timer function, the
 * `--once` CLI and the seed hand it a database, an `emit` and a source factory.
 */
const MINUTE = 60_000;
/** A space with readings is asked for the last 30 minutes (spec §3). */
export const WINDOW_MINUTES = 30;
/** A space with none is asked for a day, so the chart does not start empty (spec §3). */
export const FIRST_RUN_MINUTES = 1440;
/** Three consecutive failures mark the source disconnected (spec §3). */
export const FAILURES_BEFORE_DISCONNECTED = 3;

/** The Space columns the cycle reads. */
export interface PollSpaceRow {
  id: string;
  glucoseSource: string | null;
  sourceStatus: string;
  sourceFailures: number;
  lastReadingAt: Date | null;
}

/** The Prisma delegates the cycle uses; the real client satisfies it, tests pass a memory one. */
export interface PollDb {
  space: {
    findMany(args: {
      where: { glucoseSource: { not: null }; id?: string };
      select: {
        id: true;
        glucoseSource: true;
        sourceStatus: true;
        sourceFailures: true;
        lastReadingAt: true;
      };
    }): Promise<PollSpaceRow[]>;
    update(args: {
      where: { id: string };
      data: { sourceStatus?: string; sourceFailures?: number; lastReadingAt?: Date };
    }): Promise<unknown>;
  };
  reading: {
    findMany(args: {
      where: { spaceId: string; ts: { in: Date[] } };
      select: { ts: true };
    }): Promise<{ ts: Date }[]>;
    /** Rejects with Prisma's `P2002` when `(spaceId, ts)` exists: the atomic "is it new" decision. */
    create(args: {
      data: { spaceId: string; ts: Date; mmol: number; trend: string; source: string };
    }): Promise<unknown>;
    delete(args: { where: { spaceId_ts: { spaceId: string; ts: Date } } }): Promise<unknown>;
  };
}

/** Builds (or returns the cached) source for a space; it may throw when the credential is missing. */
export type SourceFactory = (
  space: PollSpaceRow,
  config: GlucoseSourceConfig,
) => GlucoseSource | Promise<GlucoseSource>;

export interface PollCycleDeps {
  db: PollDb;
  sources: SourceFactory;
  /** Defaults to the real `emit`; the seed and tests pass one over a memory sink. */
  emit?: EmitFn;
  now?: () => Date;
  log?: Logger;
  /** Called once per stored reading; the timer function tracks `reading.stored` here. */
  onReadingStored?: (spaceId: string) => void;
}

export interface PollCycleOptions {
  /** Poll this space only (`poll --once --space <id>`). */
  spaceId?: string;
}

export type PollOutcomeCode =
  | "ok"
  | "config-invalid"
  | "source-unavailable"
  | "fetch-failed"
  | "store-failed"
  | "status-update-failed";

export interface SpaceOutcome {
  spaceId: string;
  outcome: "ok" | "failed";
  code: PollOutcomeCode;
  /** New rows this cycle. */
  stored: number;
  status: SourceStatus;
}

/**
 * Where to fetch from: 30 minutes back for a space with readings, a day for one without. After an
 * outage it reaches back to the last reading so the gap is filled, never more than a day.
 */
export function sinceFor(lastReadingAt: Date | null, now: Date): Date {
  const floor = now.getTime() - FIRST_RUN_MINUTES * MINUTE;
  if (lastReadingAt === null) return new Date(floor);
  const window = now.getTime() - WINDOW_MINUTES * MINUTE;
  return new Date(Math.max(floor, Math.min(window, lastReadingAt.getTime())));
}

class CycleError extends Error {
  constructor(
    readonly code: PollOutcomeCode,
    cause: unknown,
  ) {
    super(code, { cause });
    this.name = "CycleError";
  }
}

/** Prisma's unique-constraint violation, matched by code so this module needs no Prisma import. */
const isUniqueViolation = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === "P2002";

const codeOf = (error: unknown): string => {
  if (error instanceof CycleError) return error.code;
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = error.code;
    if (typeof code === "string") return code;
  }
  return error instanceof Error ? error.name : "unknown";
};

/**
 * One cycle over every space with a configured source. Each space runs in its own try/catch:
 * a failing space never stops the others (plan §9). Returns one outcome per space, in order.
 */
export async function runPollCycle(
  deps: PollCycleDeps,
  options: PollCycleOptions = {},
): Promise<SpaceOutcome[]> {
  const emit = deps.emit ?? defaultEmit;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? defaultLog;
  const spaces = await deps.db.space.findMany({
    where: { glucoseSource: { not: null }, ...(options.spaceId ? { id: options.spaceId } : {}) },
    select: {
      id: true,
      glucoseSource: true,
      sourceStatus: true,
      sourceFailures: true,
      lastReadingAt: true,
    },
  });

  const outcomes: SpaceOutcome[] = [];
  for (const space of spaces) {
    outcomes.push(await pollSpace(space, { ...deps, emit, now, log }));
  }
  return outcomes;
}

type Resolved = Required<Pick<PollCycleDeps, "db" | "sources" | "emit" | "now" | "log">> &
  Pick<PollCycleDeps, "onReadingStored">;

async function pollSpace(space: PollSpaceRow, deps: Resolved): Promise<SpaceOutcome> {
  const started = deps.now();
  const spaceId = space.id;
  let stored = 0;
  let latest: Date | null = null;

  try {
    const config = parseConfig(space.glucoseSource);
    let source: GlucoseSource;
    try {
      source = await deps.sources(space, config);
    } catch (error) {
      throw new CycleError("source-unavailable", error);
    }

    const since = sinceFor(space.lastReadingAt, started);
    let readings: Reading[];
    try {
      readings = (await source.fetchSince(since))
        .filter((r) => Date.parse(r.ts) > since.getTime())
        .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
    } catch (error) {
      throw new CycleError("fetch-failed", error);
    }

    try {
      const existing = new Set(
        (
          await deps.db.reading.findMany({
            where: { spaceId, ts: { in: readings.map((r) => new Date(r.ts)) } },
            select: { ts: true },
          })
        ).map((row) => row.ts.getTime()),
      );
      for (const reading of readings) {
        const ts = new Date(reading.ts);
        if (existing.has(ts.getTime())) continue;
        const payload = Reading.parse(reading);
        // The insert decides who is first when two cycles overlap: only the one that created the
        // row emits, so a row never gets two events.
        try {
          await deps.db.reading.create({
            data: { spaceId, ts, mmol: payload.mmol, trend: payload.trend, source: config.type },
          });
        } catch (error) {
          if (isUniqueViolation(error)) continue;
          throw error;
        }
        try {
          await deps.emit(spaceId, "reading", payload);
        } catch (error) {
          // A row without its event would be skipped forever as "existing": take it back so the
          // next cycle stores and emits it together.
          await deps.db.reading.delete({ where: { spaceId_ts: { spaceId, ts } } });
          throw error;
        }
        latest = ts;
        stored += 1;
        deps.onReadingStored?.(spaceId);
      }
    } catch (error) {
      throw new CycleError("store-failed", error);
    }

    let status: SourceStatus;
    try {
      status = await markConnected(space, latest, deps);
    } catch (error) {
      throw new CycleError("status-update-failed", error);
    }
    deps.log.info("poll.space", {
      spaceId,
      count: stored,
      code: "ok",
      ms: deps.now().getTime() - started.getTime(),
    });
    return { spaceId, outcome: "ok", code: "ok", stored, status };
  } catch (error) {
    const code = error instanceof CycleError ? error.code : "fetch-failed";
    deps.log.warn("poll.space-failed", { spaceId, count: stored, code: codeOf(error) });
    // A database failure after a good fetch says nothing about the source: no failure counted.
    const status =
      code === "status-update-failed"
        ? (space.sourceStatus as SourceStatus)
        : await markFailed(space, latest, deps);
    return { spaceId, outcome: "failed", code, stored, status };
  }
}

function parseConfig(raw: string | null): GlucoseSourceConfig {
  try {
    return GlucoseSourceConfig.parse(JSON.parse(raw ?? "null"));
  } catch (error) {
    throw new CycleError("config-invalid", error);
  }
}

/**
 * The status event goes first, then the column: a change the clients never heard of would not be
 * sent again, while a repeated event is harmless to them.
 */
async function markConnected(
  space: PollSpaceRow,
  latest: Date | null,
  deps: Resolved,
): Promise<SourceStatus> {
  if (space.sourceStatus !== "connected") {
    await deps.emit(space.id, "source.status", {
      status: "connected",
      since: deps.now().toISOString(),
    });
  }
  await deps.db.space.update({
    where: { id: space.id },
    data: {
      sourceStatus: "connected",
      sourceFailures: 0,
      ...(latest ? { lastReadingAt: latest } : {}),
    },
  });
  return "connected";
}

/** Counts the failure; the third one in a row flips the status and tells the clients, once. */
async function markFailed(
  space: PollSpaceRow,
  latest: Date | null,
  deps: Resolved,
): Promise<SourceStatus> {
  const failures = space.sourceFailures + 1;
  const disconnect =
    failures >= FAILURES_BEFORE_DISCONNECTED && space.sourceStatus !== "disconnected";
  const status: SourceStatus = disconnect ? "disconnected" : (space.sourceStatus as SourceStatus);
  try {
    if (disconnect) {
      await deps.emit(space.id, "source.status", {
        status: "disconnected",
        since: deps.now().toISOString(),
      });
    }
    await deps.db.space.update({
      where: { id: space.id },
      data: {
        sourceFailures: failures,
        ...(disconnect ? { sourceStatus: "disconnected" } : {}),
        ...(latest ? { lastReadingAt: latest } : {}),
      },
    });
  } catch (error) {
    deps.log.error("poll.status-update-failed", { spaceId: space.id, code: codeOf(error) }, error);
    return space.sourceStatus as SourceStatus;
  }
  return status;
}

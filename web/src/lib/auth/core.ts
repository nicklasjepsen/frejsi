import {
  createEmit,
  createEventSinkFromEnv,
  log as defaultLog,
  prisma,
  type EventEnvelope,
  type EventPayload,
  type EventSink,
  type EventType,
  type Logger,
  type PrismaClient,
} from "@frejsi/shared";

/**
 * The Prisma delegates the auth modules read and write, `event` included: `transact` writes each
 * event row through the same transaction as the write it belongs to. Inside `transact` the same
 * shape is the transaction client, so a function that takes `TxDeps` runs the same way on its own
 * or as one step of a larger transaction.
 */
export type AuthTx = Pick<
  PrismaClient,
  "user" | "space" | "membership" | "invite" | "passkey" | "session" | "authChallenge" | "event"
>;

/** The one isolation level the auth modules ask for; the default (read committed) otherwise. */
export interface TransactionOptions {
  isolationLevel?: "Serializable";
}

export interface AuthDb extends AuthTx {
  $transaction<T>(fn: (tx: AuthTx) => Promise<T>, options?: TransactionOptions): Promise<T>;
}

/**
 * `emit()` bound to the running transaction: the event row is inserted next to the write, and
 * the envelope reaches Web PubSub after the commit. Outside `transact` there is no such thing.
 */
export type Emitter = <T extends EventType>(
  spaceId: string,
  type: T,
  payload: EventPayload<T>,
) => Promise<unknown>;

/** Dependencies of a function that only reads, or writes without an event (challenges). */
export interface DbDeps {
  db?: AuthTx;
  now?: () => Date;
}

/** What a function receives when it runs as one step of a transaction another function opened. */
export interface TxDeps {
  db: AuthTx;
  emit: Emitter;
  now?: () => Date;
}

/** Dependencies of a function that opens its own transaction. Tests pass fakes. */
export interface AuthDeps {
  db?: AuthDb;
  /** Where envelopes go after the commit; Web PubSub from the environment by default. */
  sink?: EventSink;
  now?: () => Date;
  log?: Logger;
}

let defaultSink: EventSink | undefined;

export function resolveTx(deps: DbDeps): { db: AuthTx; now: () => Date } {
  return { db: deps.db ?? prisma, now: deps.now ?? (() => new Date()) };
}

export function resolve(deps: AuthDeps): {
  db: AuthDb;
  sink: EventSink;
  now: () => Date;
  log: Logger;
} {
  return {
    db: deps.db ?? prisma,
    sink: deps.sink ?? (defaultSink ??= createEventSinkFromEnv()),
    now: deps.now ?? (() => new Date()),
    log: deps.log ?? defaultLog,
  };
}

/** A transaction client has no `$transaction` of its own; that is how the two are told apart. */
export function isTxDeps(deps: AuthDeps | TxDeps): deps is TxDeps {
  return deps.db !== undefined && !("$transaction" in deps.db);
}

/**
 * How often a transaction SQL Server killed as a deadlock victim is attempted. Two serializable
 * read-check-writes on the same rows (two owners stepping down in the same second) each take a
 * range lock on the count and then block on the other's; the victim comes back as Prisma P2034
 * and is simply run again, where it then reads the winner's state.
 */
export const TRANSACTION_ATTEMPTS = 3;

export interface TransactOptions {
  serializable?: boolean;
  now?: () => Date;
  /** Receives the line for an envelope that could not be published after the commit. */
  log?: Logger;
}

/** Prisma's code for a transaction that failed due to a write conflict or a deadlock. */
function isTransactionConflict(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2034"
  );
}

/**
 * Runs `fn` in one Prisma transaction with an `emit` bound to it: every event row is written in
 * the same transaction as the write it describes, so a write that rolls back never has an event,
 * a committed write always has its row, and `/events?since` can hand it out. The envelopes are
 * queued and published to Web PubSub after the commit, in order; a failed publish is logged, as
 * `emit()` itself does, because the row is committed and clients catch up through the table.
 *
 * `serializable` is for a read-check-write that must not interleave with another request's
 * (the last-owner guard, the one-shot bootstrap): Azure SQL's default read-committed snapshot
 * would let both see the state before either wrote. A deadlock victim is retried, see
 * `TRANSACTION_ATTEMPTS`.
 */
export async function transact<T>(
  db: AuthDb,
  sink: EventSink,
  fn: (tx: AuthTx, emit: Emitter) => Promise<T>,
  options: TransactOptions = {},
): Promise<T> {
  const log = options.log ?? defaultLog;
  const now = options.now ?? (() => new Date());
  const isolation = options.serializable ? { isolationLevel: "Serializable" as const } : undefined;

  for (let attempt = 1; ; attempt += 1) {
    const queued: { group: string; envelope: EventEnvelope }[] = [];
    const deferredSink: EventSink = {
      publish: (group, envelope) => {
        queued.push({ group, envelope });
        return Promise.resolve();
      },
    };
    let result: T;
    try {
      result = await db.$transaction((tx) => {
        const emit = createEmit({
          db: { $transaction: (run) => run(tx) },
          sink: deferredSink,
          now,
        });
        return fn(tx, emit);
      }, isolation);
    } catch (error) {
      if (attempt < TRANSACTION_ATTEMPTS && isTransactionConflict(error)) continue;
      throw error;
    }
    for (const { group, envelope } of queued) {
      try {
        await sink.publish(group, envelope);
      } catch {
        log.warn("event.publish-failed", { spaceId: envelope.spaceId, code: "publish-failed" });
      }
    }
    return result;
  }
}

/**
 * Runs `fn` as a transaction of its own, or as a step of the one the caller is already in when
 * `deps` came from inside `transact`. The functions that both routes and the registration or
 * bootstrap transaction call (invites, memberships) go through this.
 */
export function run<T>(
  deps: AuthDeps | TxDeps,
  fn: (tx: AuthTx, emit: Emitter, now: () => Date) => Promise<T>,
  options: { serializable?: boolean } = {},
): Promise<T> {
  if (isTxDeps(deps)) return fn(deps.db, deps.emit, deps.now ?? (() => new Date()));
  const { db, sink, now, log } = resolve(deps);
  return transact(db, sink, (tx, emit) => fn(tx, emit, now), { ...options, now, log });
}

/**
 * The app's origin, `https://frejsi.jepsen.ninja` in production (plan §7). Required: the RP ID
 * and the origin check of every ceremony derive from it, so there is no default.
 */
export function appOrigin(): string {
  const value = process.env.APP_ORIGIN;
  if (!value) throw new Error("APP_ORIGIN is required");
  const url = new URL(value);
  if (url.protocol !== "https:" && url.hostname !== "localhost") {
    throw new Error("APP_ORIGIN must be https (or http://localhost for development)");
  }
  return url.origin;
}

/** The WebAuthn relying party id: the host of `APP_ORIGIN` (plan §6). */
export function rpId(): string {
  return new URL(appOrigin()).hostname;
}

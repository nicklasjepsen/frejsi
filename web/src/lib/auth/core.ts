import {
  emit as defaultEmit,
  log as defaultLog,
  prisma,
  type EventPayload,
  type EventType,
  type Logger,
  type PrismaClient,
} from "@frejsi/shared";

/**
 * The Prisma delegates the auth modules read and write. Inside `transact` the same shape is the
 * transaction client, so a function that takes `AuthTx` runs the same way on its own or as one
 * step of a larger transaction.
 */
export type AuthTx = Pick<
  PrismaClient,
  "user" | "space" | "membership" | "invite" | "passkey" | "session" | "authChallenge"
>;

/** The one isolation level the auth modules ask for; the default (read committed) otherwise. */
export interface TransactionOptions {
  isolationLevel?: "Serializable";
}

export interface AuthDb extends AuthTx {
  $transaction<T>(fn: (tx: AuthTx) => Promise<T>, options?: TransactionOptions): Promise<T>;
}

/**
 * `emit()` without its return value. Inside a transaction the event is queued until the commit,
 * so the function doing the write never sees an envelope; outside it is `emit` itself.
 */
export type Emitter = <T extends EventType>(
  spaceId: string,
  type: T,
  payload: EventPayload<T>,
) => Promise<unknown>;

/** Dependencies of a function that does its own, single writes. Tests pass fakes. */
export interface TxDeps {
  db?: AuthTx;
  emit?: Emitter;
  now?: () => Date;
}

/** Dependencies of a function that opens a transaction. */
export interface AuthDeps extends TxDeps {
  db?: AuthDb;
}

export function resolveTx(deps: TxDeps): { db: AuthTx; emit: Emitter; now: () => Date } {
  return {
    db: deps.db ?? prisma,
    emit: deps.emit ?? defaultEmit,
    now: deps.now ?? (() => new Date()),
  };
}

export function resolve(deps: AuthDeps): { db: AuthDb; emit: Emitter; now: () => Date } {
  return {
    db: deps.db ?? prisma,
    emit: deps.emit ?? defaultEmit,
    now: deps.now ?? (() => new Date()),
  };
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
  /** Receives the line for an event that could not be emitted after the commit. */
  log?: Logger;
}

/** Prisma's code for a transaction that failed due to a write conflict or a deadlock. */
function isTransactionConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2034"
  );
}

/**
 * Runs `fn` in one Prisma transaction and delivers every event it emitted after the commit, in
 * order. A write that rolls back therefore never has an event, and an event never precedes its
 * row (plan §5: every write is followed by its event). An event that fails after the commit is
 * logged, not thrown: the write stands and the caller's response (a session cookie, say) must
 * not be withheld for it; clients catch up through `/events?since` or a reload.
 *
 * `serializable` is for a read-check-write that must not interleave with another request's
 * (the last-owner guard, the one-shot bootstrap): Azure SQL's default read-committed snapshot
 * would let both see the state before either wrote. A deadlock victim is retried, see
 * `TRANSACTION_ATTEMPTS`.
 */
export async function transact<T>(
  db: AuthDb,
  emit: Emitter,
  fn: (tx: AuthTx, emit: Emitter) => Promise<T>,
  options: TransactOptions = {},
): Promise<T> {
  const log = options.log ?? defaultLog;
  const isolation = options.serializable ? { isolationLevel: "Serializable" as const } : undefined;

  for (let attempt = 1; ; attempt += 1) {
    const queued: { spaceId: string; publish: () => Promise<unknown> }[] = [];
    const deferred: Emitter = (spaceId, type, payload) => {
      queued.push({ spaceId, publish: () => emit(spaceId, type, payload) });
      return Promise.resolve();
    };
    let result: T;
    try {
      result = await db.$transaction((tx) => fn(tx, deferred), isolation);
    } catch (error) {
      if (attempt < TRANSACTION_ATTEMPTS && isTransactionConflict(error)) continue;
      throw error;
    }
    for (const { spaceId, publish } of queued) {
      try {
        await publish();
      } catch (error) {
        log.error("event.emit-failed", { spaceId, code: "emit-failed" }, error);
      }
    }
    return result;
  }
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

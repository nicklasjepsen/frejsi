import {
  emit as defaultEmit,
  prisma,
  type EventPayload,
  type EventType,
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

export interface AuthDb extends AuthTx {
  $transaction<T>(fn: (tx: AuthTx) => Promise<T>): Promise<T>;
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
 * Runs `fn` in one Prisma transaction and delivers every event it emitted after the commit, in
 * order. A write that rolls back therefore never has an event, and an event never precedes its
 * row (plan §5: every write is followed by its event).
 */
export async function transact<T>(
  db: AuthDb,
  emit: Emitter,
  fn: (tx: AuthTx, emit: Emitter) => Promise<T>,
): Promise<T> {
  const queued: (() => Promise<unknown>)[] = [];
  const deferred: Emitter = (spaceId, type, payload) => {
    queued.push(() => emit(spaceId, type, payload));
    return Promise.resolve();
  };
  const result = await db.$transaction((tx) => fn(tx, deferred));
  for (const publish of queued) await publish();
  return result;
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

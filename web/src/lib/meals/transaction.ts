import {
  createEmit,
  createEventSinkFromEnv,
  log,
  prisma,
  type EmitFn,
  type EmitTx,
  type EventEnvelope,
  type EventSink,
  type PrismaClient,
} from "@frejsi/shared";
import { PrismaPumpLinks, type PumpLinks } from "./pump";
import { PrismaMealRepository, type MealRepository } from "./repository";

type MealTx = Pick<PrismaClient, "meal" | "food" | "pumpBolus"> & EmitTx;
export interface MealWriteDb {
  $transaction<T>(
    work: (tx: MealTx) => Promise<T>,
    options?: { isolationLevel: "Serializable" },
  ): Promise<T>;
}
/**
 * `pump` is the pump record inside the same transaction (v0.7.0 plan §6). A writer without it (a
 * test fake) writes meals without matching them to boluses.
 */
export type MealWriter = <T>(
  work: (repo: MealRepository, emit: EmitFn, pump?: PumpLinks) => Promise<T>,
) => Promise<T>;

/** SQL Server ends one of two crossing Serializable transactions as a deadlock victim (P2034). */
const serializationFailure = (error: unknown) =>
  typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2034";

/**
 * Reuse emit's validation/sequence allocation inside the meal transaction; publish only after
 * commit. Serializable, so the matcher's read of the window and its link writes see no other
 * meal write or pump cycle in between (one bolus, one meal), and retried once when SQL Server
 * picks it as the victim; the first attempt's events are dropped with its rollback.
 */
export function createMealWriter(
  db: MealWriteDb = prisma,
  sink: EventSink = createEventSinkFromEnv(),
  now: () => Date = () => new Date(),
): MealWriter {
  return async (work) => {
    let pending: { group: string; envelope: EventEnvelope }[] = [];
    const attempt = () => {
      pending = [];
      return db.$transaction(
        async (tx) => {
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
          return work(new PrismaMealRepository(tx), emit, new PrismaPumpLinks(tx));
        },
        { isolationLevel: "Serializable" },
      );
    };
    let result;
    try {
      result = await attempt();
    } catch (error) {
      if (!serializationFailure(error)) throw error;
      result = await attempt();
    }
    for (const { group, envelope } of pending) {
      try {
        await sink.publish(group, envelope);
      } catch {
        log.warn("event.publish-failed", { spaceId: envelope.spaceId, code: "publish-failed" });
      }
    }
    return result;
  };
}

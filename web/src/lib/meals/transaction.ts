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
import { PrismaMealRepository, type MealRepository } from "./repository";

type MealTx = Pick<PrismaClient, "meal" | "food"> & EmitTx;
export interface MealWriteDb {
  $transaction<T>(work: (tx: MealTx) => Promise<T>): Promise<T>;
}
export type MealWriter = <T>(
  work: (repo: MealRepository, emit: EmitFn) => Promise<T>,
) => Promise<T>;

/** Reuse emit's validation/sequence allocation inside the meal transaction; publish only after commit. */
export function createMealWriter(
  db: MealWriteDb = prisma,
  sink: EventSink = createEventSinkFromEnv(),
  now: () => Date = () => new Date(),
): MealWriter {
  return async (work) => {
    const pending: { group: string; envelope: EventEnvelope }[] = [];
    const result = await db.$transaction(async (tx) => {
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
      return work(new PrismaMealRepository(tx), emit);
    });
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

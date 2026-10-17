import {
  createEmit,
  createEventSinkFromEnv,
  log,
  prisma,
  type EmitFn,
  type EmitTx,
  type EventEnvelope,
  type EventSink,
} from "@frejsi/shared";
import { PrismaSymptomRepository, type SymptomDb, type SymptomRepository } from "./repository";

type SymptomTx = SymptomDb & EmitTx;
export interface SymptomWriteDb {
  $transaction<T>(work: (tx: SymptomTx) => Promise<T>): Promise<T>;
}
export type SymptomWriter = <T>(
  work: (repo: SymptomRepository, emit: EmitFn) => Promise<T>,
) => Promise<T>;

/** The row and its event in one transaction, as meals do; the sink hears it only after commit. */
export function createSymptomWriter(
  db: SymptomWriteDb = prisma,
  sink: EventSink = createEventSinkFromEnv(),
  now: () => Date = () => new Date(),
): SymptomWriter {
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
      return work(new PrismaSymptomRepository(tx), emit);
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

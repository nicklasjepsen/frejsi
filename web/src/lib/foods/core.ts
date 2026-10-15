import {
  createEmit,
  createEventSinkFromEnv,
  log,
  prisma,
  type EmitFn,
  type EventEnvelope,
  type EventSink,
  type Logger,
  type PrismaClient,
} from "@frejsi/shared";
import { foodSources } from "@frejsi/shared/food";
import { createPhotoStoreFromEnv, type PhotoStore } from "@frejsi/shared/photos";
import type { FoodSource } from "@frejsi/shared";

export type FoodTx = Pick<PrismaClient, "food" | "mealItem" | "space" | "event">;
export interface FoodDb extends FoodTx {
  $transaction<T>(
    run: (tx: FoodTx) => Promise<T>,
    options?: { isolationLevel: "Serializable" },
  ): Promise<T>;
}
import type { SessionDb } from "@/lib/auth/session";

export interface FoodDeps {
  sessionDb?: SessionDb;
  db?: FoodDb;
  sink?: EventSink;
  now?: () => Date;
  photos?: PhotoStore | null;
  sources?: FoodSource[];
  log?: Logger;
}
let overrides: FoodDeps = {};
/** Server/test composition point; services also accept explicit dependencies for the seed. */
export function configureFoods(deps: FoodDeps): void {
  overrides = deps;
}
export function resolveFoods(deps: FoodDeps = {}) {
  const all = { ...overrides, ...deps };
  return {
    db: (all.db ?? prisma) as FoodDb,
    sessionDb: all.sessionDb ?? prisma,
    sink: all.sink ?? createEventSinkFromEnv(),
    now: all.now ?? (() => new Date()),
    photos: all.photos !== undefined ? all.photos : createPhotoStoreFromEnv(),
    sources: all.sources ?? foodSources(process.env),
    log: all.log ?? log,
  };
}
export type ResolvedFoods = ReturnType<typeof resolveFoods>;

/** Write and event rows commit together; only committed envelopes reach the sink. */
export async function foodTransaction<T>(
  deps: ResolvedFoods,
  run: (tx: FoodTx, emit: EmitFn) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const queued: { group: string; envelope: EventEnvelope }[] = [];
    let result: T;
    try {
      result = await deps.db.$transaction(
        (tx) => {
          const emit = createEmit({
            db: { $transaction: (callback) => callback(tx) },
            now: deps.now,
            sink: {
              publish: (group, envelope) => {
                queued.push({ group, envelope });
                return Promise.resolve();
              },
            },
          });
          return run(tx, emit);
        },
        { isolationLevel: "Serializable" },
      );
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error ? error.code : null;
      // Concurrent picks use the unique (spaceId, sourceRef) pair; retry a deadlock victim
      // or duplicate insert in a fresh transaction, then return the winning copy without an event.
      if (attempt < 2 && (code === "P2034" || code === "P2002")) continue;
      throw error;
    }
    for (const { group, envelope } of queued) {
      try {
        await deps.sink.publish(group, envelope);
      } catch {
        deps.log.warn("event.publish-failed", {
          spaceId: envelope.spaceId,
          code: "publish-failed",
        });
      }
    }
    return result;
  }
}

// The one writer of `Reading` rows in `web/` (plan §5): a hand-typed finger-prick value. The row,
// the forward-only `lastReadingAt` and the `reading` event commit together; the event is
// published after the commit, to the glucose group only, so a viewer's token never carries it.
import {
  createEmit,
  createEventSinkFromEnv,
  GlucoseSourceConfig,
  HttpError,
  ManualReadingRequest,
  prisma,
  Reading,
  trackEvent,
  log,
  type EmitTx,
  type EventEnvelope,
  type EventSink,
  type PrismaClient,
} from "@frejsi/shared";
import { z } from "zod";

import { MANUAL_FUTURE_MS, MANUAL_WINDOW_MS, toMmol } from "./range";

/** The request as sent: `ts` optional here so that the route's own clock supplies "now". */
export const ManualReadingBody = ManualReadingRequest.extend({ ts: z.iso.datetime().optional() });

export type ReadingTx = Pick<PrismaClient, "space" | "reading"> & EmitTx;
export interface ReadingWriteDb {
  $transaction<T>(work: (tx: ReadingTx) => Promise<T>): Promise<T>;
}

export interface ReadingDeps {
  db: ReadingWriteDb;
  sink: EventSink;
  now: () => Date;
  /** The custom event the 35-minute alert watches (plan decision 8). */
  track: (name: string, properties?: Record<string, string>) => void;
}

let overrides: Partial<ReadingDeps> = {};
/** Tests only. */
export function configureReadings(deps: Partial<ReadingDeps>): void {
  overrides = deps;
}
let envSink: EventSink | undefined;
export function readingDeps(): ReadingDeps {
  return {
    db: overrides.db ?? prisma,
    sink: overrides.sink ?? (envSink ??= createEventSinkFromEnv()),
    now: overrides.now ?? (() => new Date()),
    track: overrides.track ?? trackEvent,
  };
}

function isManual(glucoseSource: string | null): boolean {
  if (!glucoseSource) return false;
  try {
    const parsed = GlucoseSourceConfig.safeParse(JSON.parse(glucoseSource));
    return parsed.success && parsed.data.type === "manual";
  } catch {
    return false;
  }
}

/**
 * Stores `(spaceId, ts)` with the value in mmol/L, `trend: "not-computable"`, `source: "manual"`.
 * The same `ts` again replaces the value (how a typo is corrected, plan decision 6); a `ts` held
 * by a sensor row is refused and nothing changes. The caller has checked the role.
 */
export async function addManualReading(
  spaceId: string,
  input: z.infer<typeof ManualReadingBody>,
  deps: ReadingDeps = readingDeps(),
): Promise<Reading> {
  const now = deps.now();
  const ts = new Date(input.ts ?? now.toISOString());
  const age = now.getTime() - ts.getTime();
  if (age > MANUAL_WINDOW_MS || -age > MANUAL_FUTURE_MS) {
    throw new HttpError(400, "reading-out-of-window");
  }
  const mmol = toMmol(input.value, input.unit);
  if (mmol === null) throw new HttpError(400, "validation");

  const pending: { group: string; envelope: EventEnvelope }[] = [];
  const stored = await deps.db.$transaction(async (tx) => {
    const space = await tx.space.findUnique({
      where: { id: spaceId },
      select: { glucoseSource: true },
    });
    if (!space) throw new HttpError(404, "not-found");
    if (!isManual(space.glucoseSource)) throw new HttpError(409, "source-not-manual");

    const held = await tx.reading.findUnique({
      where: { spaceId_ts: { spaceId, ts } },
      select: { source: true },
    });
    if (held && held.source !== "manual") throw new HttpError(409, "reading-exists");

    const trend = "not-computable" as const;
    await tx.reading.upsert({
      where: { spaceId_ts: { spaceId, ts } },
      create: { spaceId, ts, mmol, trend, source: "manual" },
      update: { mmol, trend },
    });
    // Forward only: a reading entered for an earlier time never moves the cursor back.
    await tx.space.updateMany({
      where: { id: spaceId, OR: [{ lastReadingAt: null }, { lastReadingAt: { lt: ts } }] },
      data: { lastReadingAt: ts },
    });
    const payload = Reading.parse({ ts: ts.toISOString(), mmol, trend });
    const emit = createEmit({
      db: { $transaction: (callback) => callback(tx) },
      sink: {
        publish: (group, envelope) => {
          pending.push({ group, envelope });
          return Promise.resolve();
        },
      },
      now: deps.now,
    });
    await emit(spaceId, "reading", payload);
    return payload;
  });

  for (const { group, envelope } of pending) {
    try {
      await deps.sink.publish(group, envelope);
    } catch {
      log.warn("event.publish-failed", { spaceId, code: "publish-failed" });
    }
  }
  deps.track("reading.stored", { spaceId });
  return stored;
}

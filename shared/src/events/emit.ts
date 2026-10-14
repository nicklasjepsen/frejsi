import { prisma } from "../db/client";
import { log as defaultLog } from "../log";
import { EventEnvelope, EventPayloads, type EventPayload, type EventType } from "../schemas/events";
import { createEventSinkFromEnv } from "./pubsub";
import type { EventSink } from "./types";

/** The two Prisma delegates `emit` uses inside its transaction. */
export interface EmitTx {
  space: {
    update(args: {
      where: { id: string };
      data: { lastSeq: { increment: number } };
      select: { lastSeq: true };
    }): Promise<{ lastSeq: number }>;
  };
  event: {
    create(args: {
      data: { spaceId: string; seq: number; type: string; payload: string; ts: Date };
    }): Promise<unknown>;
  };
}

export interface EmitDb {
  $transaction<T>(fn: (tx: EmitTx) => Promise<T>): Promise<T>;
}

export interface EmitDeps {
  db: EmitDb;
  sink: EventSink;
  now?: () => Date;
  /** Receives one JSON line per failed publish; defaults to the no-PII logger. */
  log?: (line: string) => void;
}

export type EmitFn = <T extends EventType>(
  spaceId: string,
  type: T,
  payload: EventPayload<T>,
) => Promise<EventEnvelope>;

/** `reading` goes to the glucose group that viewers cannot join; everything else to the space group. */
export function groupFor(spaceId: string, type: EventType): string {
  return type === "reading" ? `space-${spaceId}-glucose` : `space-${spaceId}`;
}

/**
 * Builds an `emit` over explicit dependencies. Production code uses the `emit` export below; the
 * seed, the CLI and tests build their own with a memory sink.
 */
export function createEmit(deps: EmitDeps): EmitFn {
  const now = deps.now ?? (() => new Date());
  const write =
    deps.log ??
    ((line: string) => {
      defaultLog.raw(line);
    });

  return async (spaceId, type, payload) => {
    const parsedPayload = EventPayloads[type].parse(payload);
    const ts = now();

    const seq = await deps.db.$transaction(async (tx) => {
      const { lastSeq } = await tx.space.update({
        where: { id: spaceId },
        data: { lastSeq: { increment: 1 } },
        select: { lastSeq: true },
      });
      await tx.event.create({
        data: { spaceId, seq: lastSeq, type, payload: JSON.stringify(parsedPayload), ts },
      });
      return lastSeq;
    });

    const envelope = EventEnvelope.parse({
      spaceId,
      seq,
      ts: ts.toISOString(),
      type,
      payload: parsedPayload,
    });

    try {
      await deps.sink.publish(groupFor(spaceId, type), envelope);
    } catch (error) {
      // The row is committed; clients catch up through /events?since on reconnect or poll.
      write(
        JSON.stringify({
          ts: now().toISOString(),
          level: "warn",
          msg: "event.publish-failed",
          spaceId,
          code: "publish-failed",
          error: error instanceof Error ? error.name : "unknown",
        }),
      );
    }
    return envelope;
  };
}

let defaultEmit: EmitFn | undefined;

/** The seed and the CLI call this once to route events through a memory sink or a specific DB. */
export function configureEmit(deps: EmitDeps): void {
  defaultEmit = createEmit(deps);
}

/**
 * The only way to write an event (plan §5): one atomic increment of `Space.lastSeq`, the row at
 * `(spaceId, seq)`, then the envelope to Web PubSub. Every API route and the poller call it after
 * their own write.
 */
export const emit: EmitFn = (spaceId, type, payload) => {
  defaultEmit ??= createEmit({ db: prisma, sink: createEventSinkFromEnv() });
  return defaultEmit(spaceId, type, payload);
};

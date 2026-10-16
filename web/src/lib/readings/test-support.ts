// An in-memory write side over `FakeLiveDb`: the delegates `addManualReading` and `emit` use, with
// a rollback when the transaction throws. Imported by *.test.ts only.
import type { EventEnvelope, EventSink } from "@frejsi/shared";

import type { FakeLiveDb } from "@/lib/live/test-support";

import type { ReadingTx, ReadingWriteDb } from "./service";

interface Held {
  spaceId: string;
  ts: Date;
  mmol: number;
  trend: string;
  source: string;
}

export class ReadingsFake {
  /** Every row written by the sensor, to test the `reading-exists` refusal. */
  readonly writes: string[] = [];
  readonly published: { group: string; envelope: EventEnvelope }[] = [];
  failEvent = false;
  /** Runs between the service reading the space and its guarded write: a source switch that commits there. */
  beforeGuard: (() => void) | null = null;

  constructor(readonly live: FakeLiveDb) {}

  readonly sink: EventSink = {
    publish: (group, envelope) => {
      this.published.push({ group, envelope });
      return Promise.resolve();
    },
  };

  addSensorReading(spaceId: string, ts: string, mmol: number, source = "dexcom-share"): void {
    this.live.readings.push({ spaceId, ts: new Date(ts), mmol, trend: "flat", source });
  }

  source(spaceId: string, ts: string): string | undefined {
    return (
      this.live.readings.find((r) => r.spaceId === spaceId && r.ts.toISOString() === ts) as
        Held | undefined
    )?.source;
  }

  get db(): ReadingWriteDb {
    const live = this.live;
    const find = (spaceId: string, ts: Date) =>
      (live.readings as Held[]).find(
        (r) => r.spaceId === spaceId && r.ts.getTime() === ts.getTime(),
      );
    const tx = {
      space: {
        findUnique: (args: { where: { id: string } }) =>
          Promise.resolve(live.spaces.find((s) => s.id === args.where.id) ?? null),
        update: (args: { where: { id: string } }) => {
          const space = live.spaces.find((s) => s.id === args.where.id);
          if (!space) throw new Error("no space");
          space.lastSeq = (space.lastSeq as number) + 1;
          return Promise.resolve({ lastSeq: space.lastSeq });
        },
        updateMany: (args: {
          where: { id: string; glucoseSource?: string | null; OR?: unknown[] };
          data: { lastReadingAt?: Date; glucoseSource?: string | null };
        }) => {
          const space = live.spaces.find((s) => s.id === args.where.id);
          if (args.data.glucoseSource !== undefined) {
            this.beforeGuard?.();
            return Promise.resolve({
              count: space?.glucoseSource === args.where.glucoseSource ? 1 : 0,
            });
          }
          this.writes.push("space.lastReadingAt");
          const current = space?.lastReadingAt as Date | null | undefined;
          const lt = (args.where.OR?.[1] as { lastReadingAt: { lt: Date } }).lastReadingAt.lt;
          if (space && args.data.lastReadingAt && (!current || current < lt)) {
            space.lastReadingAt = args.data.lastReadingAt;
            return Promise.resolve({ count: 1 });
          }
          return Promise.resolve({ count: 0 });
        },
      },
      reading: {
        findUnique: (args: { where: { spaceId_ts: { spaceId: string; ts: Date } } }) => {
          const { spaceId, ts } = args.where.spaceId_ts;
          return Promise.resolve(find(spaceId, ts) ?? null);
        },
        upsert: (args: {
          where: { spaceId_ts: { spaceId: string; ts: Date } };
          create: Held;
          update: { mmol: number; trend: string };
        }) => {
          this.writes.push("reading.upsert");
          const { spaceId, ts } = args.where.spaceId_ts;
          const row = find(spaceId, ts);
          if (row) Object.assign(row, args.update);
          else (live.readings as Held[]).push({ ...args.create });
          return Promise.resolve({});
        },
      },
      event: {
        create: (args: {
          data: { spaceId: string; seq: number; type: string; payload: string; ts: Date };
        }) => {
          if (this.failEvent) return Promise.reject(new Error("event table down"));
          live.events.push({ ...args.data });
          return Promise.resolve({});
        },
      },
    } as unknown as ReadingTx;
    return {
      $transaction: async (work) => {
        const saved = {
          readings: live.readings.map((r) => ({ ...r })),
          events: [...live.events],
          spaces: live.spaces.map((s) => ({ ...s })),
        };
        try {
          return await work(tx);
        } catch (error) {
          live.readings.splice(0, live.readings.length, ...saved.readings);
          live.events.splice(0, live.events.length, ...saved.events);
          live.spaces.splice(0, live.spaces.length, ...saved.spaces);
          throw error;
        }
      },
    };
  }
}

// Manual readings against a real SQL Server (v0.5.0 task 9, spec §3 and §7): the upsert replaces a
// value at the same `ts`, a `ts` held by a sensor row is refused, `lastReadingAt` only moves
// forward under concurrent writes, and the viewer's event query never returns a `reading` row
// even with manual readings present. Fictional values throughout.
// `pnpm --filter ./shared test:integration` with `DATABASE_URL`; release.yml only.
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createEmit } from "../../src/events/emit";
import { MemoryEventSink } from "../../src/events/memory";
import type { EventEnvelope, Role } from "../../src/schemas/index";
import { createEmptyDatabase, migrate, type ScratchDatabase } from "./database";

/** The web app's one writer of manual readings and its viewer query, loaded from web/src. */
interface ReadingService {
  addManualReading: (
    spaceId: string,
    input: { value: number; unit: "mmol" | "mgdl"; ts?: string },
    deps: {
      db: PrismaClient;
      sink: MemoryEventSink;
      now: () => Date;
      track: () => void;
    },
  ) => Promise<{ ts: string; mmol: number }>;
}
interface EventsPageModule {
  loadEventsPage: (
    spaceId: string,
    since: number,
    role: Role,
    db: PrismaClient,
  ) => Promise<{ lastSeq: number; events: EventEnvelope[]; more: boolean }>;
}
const SERVICE = "@/lib/readings/service";
const LIVE_SERVER = "@/lib/live/server";

const NOW = new Date("2026-10-15T13:00:00.000Z");
const at = (minutesAgo: number) => new Date(NOW.getTime() - minutesAgo * 60_000);

let scratch: ScratchDatabase;
let db: PrismaClient;
let service: ReadingService;

beforeAll(async () => {
  scratch = await createEmptyDatabase("frejsi_manual_it");
  migrate(scratch.url);
  db = new PrismaClient({ datasourceUrl: scratch.url });
  service = (await import(SERVICE)) as ReadingService;
});
afterAll(async () => {
  await db.$disconnect();
  await scratch.drop();
});

async function manualSpace(name: string): Promise<string> {
  const space = await db.space.create({
    data: {
      name,
      timezone: "Europe/Copenhagen",
      glucoseSource: JSON.stringify({ type: "manual" }),
      sourceStatus: "connected",
    },
  });
  return space.id;
}

function write(spaceId: string, value: number, ts: Date) {
  return service.addManualReading(
    spaceId,
    { value, unit: "mmol", ts: ts.toISOString() },
    { db, sink: new MemoryEventSink(), now: () => NOW, track: () => undefined },
  );
}

describe("manual readings on SQL Server", () => {
  it("replaces the value at the same ts and keeps one row", async () => {
    const spaceId = await manualSpace("Manual upsert");
    await write(spaceId, 7.4, at(30));
    await write(spaceId, 4.7, at(30));
    const rows = await db.reading.findMany({ where: { spaceId } });
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]?.mmol)).toBe(4.7);
    expect(rows[0]).toMatchObject({ source: "manual", trend: "not-computable" });
  });

  it("refuses a ts held by a dexcom-share row and changes nothing", async () => {
    const spaceId = await manualSpace("Manual refused");
    await db.reading.create({
      data: { spaceId, ts: at(60), mmol: 6.1, trend: "flat", source: "dexcom-share" },
    });
    const events = await db.event.count({ where: { spaceId } });
    await expect(write(spaceId, 9.9, at(60))).rejects.toMatchObject({
      status: 409,
      code: "reading-exists",
    });
    const rows = await db.reading.findMany({ where: { spaceId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "dexcom-share" });
    expect(Number(rows[0]?.mmol)).toBe(6.1);
    expect(await db.event.count({ where: { spaceId } })).toBe(events);
  });

  it("moves lastReadingAt forward only, under concurrent writes", async () => {
    const spaceId = await manualSpace("Manual concurrent");
    // Eight writes at once, newest not first and not last.
    const minutes = [50, 10, 40, 20, 5, 35, 25, 45];
    await Promise.all(minutes.map((m, i) => write(spaceId, 5 + i * 0.5, at(m))));
    const space = await db.space.findUniqueOrThrow({ where: { id: spaceId } });
    expect(space.lastReadingAt?.toISOString()).toBe(at(5).toISOString());
    expect(await db.reading.count({ where: { spaceId } })).toBe(8);
    // An older value entered afterwards does not move the cursor back.
    await write(spaceId, 6.6, at(55));
    const after = await db.space.findUniqueOrThrow({ where: { id: spaceId } });
    expect(after.lastReadingAt?.toISOString()).toBe(at(5).toISOString());
    // And every row has its event, in a gap-free sequence.
    const events = await db.event.findMany({ where: { spaceId }, orderBy: { seq: "asc" } });
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));
    expect(events.filter((e) => e.type === "reading")).toHaveLength(9);
  });

  it("never returns a manual reading event to a viewer, while the cursor passes it", async () => {
    const spaceId = await manualSpace("Manual viewer");
    await createEmit({ db, sink: new MemoryEventSink() })(spaceId, "member.joined", {
      userId: "viewer-user",
      role: "viewer",
    });
    await write(spaceId, 7.4, at(20));
    await write(spaceId, 8.2, at(10));

    const { loadEventsPage } = (await import(LIVE_SERVER)) as EventsPageModule;
    const viewer = await loadEventsPage(spaceId, 0, "viewer", db);
    expect(viewer.events.map((e) => e.type)).toEqual(["member.joined"]);
    expect(viewer.lastSeq).toBe(3);
    const carer = await loadEventsPage(spaceId, 0, "carer", db);
    expect(carer.events.map((e) => e.type)).toEqual(["member.joined", "reading", "reading"]);
  });
});

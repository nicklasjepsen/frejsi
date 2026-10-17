// Prisma against a real SQL Server (plan §8, task 10): the migration from empty, the reading
// insert the poller relies on, `seq` allocation under concurrency and the viewer's event query.
// `pnpm --filter ./shared test:integration` with `DATABASE_URL`; release.yml only.
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createEmit } from "../../src/events/emit";
import { MemoryEventSink } from "../../src/events/memory";
import { FakeGlucoseSource } from "../../src/glucose/fake";
import { runPollCycle } from "../../src/glucose/poll-cycle";
import { createLogger } from "../../src/log";
import type { EventEnvelope, Role } from "../../src/schemas/index";
import { glucoseSecretName } from "../../src/secrets/types";
import {
  createEmptyDatabase,
  migrate,
  prismaCli,
  SCHEMA,
  schemaDiff,
  type ScratchDatabase,
} from "./database";

/** The web app's viewer query (`/api/spaces/:id/events`), loaded at run time from web/src. */
interface EventsPageModule {
  loadEventsPage: (
    spaceId: string,
    since: number,
    role: Role,
    db: PrismaClient,
  ) => Promise<{ lastSeq: number; events: EventEnvelope[]; more: boolean }>;
}
const LIVE_SERVER = "@/lib/live/server";

const quiet = createLogger(() => undefined);
let scratch: ScratchDatabase;
let db: PrismaClient;

beforeAll(async () => {
  scratch = await createEmptyDatabase();
  db = new PrismaClient({ datasourceUrl: scratch.url });
});

afterAll(async () => {
  await db.$disconnect();
  await scratch.drop();
});

async function newSpace(name: string): Promise<string> {
  const space = await db.space.create({ data: { name, timezone: "Europe/Copenhagen" } });
  return space.id;
}

async function withFakeSource(spaceId: string): Promise<void> {
  await db.space.update({
    where: { id: spaceId },
    data: {
      glucoseSource: JSON.stringify({
        type: "dexcom-share",
        region: "eu",
        secretRef: glucoseSecretName(spaceId),
      }),
    },
  });
}

function cycle(spaceId: string, at: Date) {
  const now = () => at;
  return runPollCycle(
    {
      db,
      sources: () => new FakeGlucoseSource({ now }),
      emit: createEmit({ db, sink: new MemoryEventSink(), now }),
      now,
      log: quiet,
    },
    { spaceId },
  );
}

async function counts(spaceId: string) {
  const [readings, readingEvents] = await Promise.all([
    db.reading.count({ where: { spaceId } }),
    db.event.count({ where: { spaceId, type: "reading" } }),
  ]);
  return { readings, readingEvents };
}

describe("the database (SQL Server)", () => {
  it("applies the migration to an empty database and ends at the schema", async () => {
    const before = await db.$queryRaw<{ n: number }[]>`
      SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE'`;
    expect(Number(before[0]?.n)).toBe(0);

    migrate(scratch.url);

    const applied = await db.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM _prisma_migrations
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    expect(applied.map((row) => row.migration_name).sort()).toEqual([
      "0001_foundation",
      "0002_food",
      "0003_ai",
      "0004_theme",
      "0005_feel",
    ]);
    // Nothing left between the migrated database and schema.prisma: exit code 0, no script.
    const diff = await schemaDiff(scratch.url, db);
    expect(diff).not.toMatch(/CREATE|ALTER|DROP/);
  });

  it("applies 0005_feel to a database at 0004 without losing a row (v0.6.0 plan §3)", async () => {
    const older = await createEmptyDatabase("frejsi_feel_it");
    const olderDb = new PrismaClient({ datasourceUrl: older.url });
    try {
      // Bring the database to the state of v0.5.x: the first four migrations, marked as applied.
      for (const name of ["0001_foundation", "0002_food", "0003_ai", "0004_theme"]) {
        prismaCli(
          ["db", "execute", "--file", `prisma/migrations/${name}/migration.sql`, "--schema", SCHEMA],
          older.url,
        );
        prismaCli(["migrate", "resolve", "--applied", name, "--schema", SCHEMA], older.url);
      }
      // Fictional rows written in SQL: the generated client already expects the new columns.
      await olderDb.$executeRaw`INSERT INTO [User] ([id], [name]) VALUES ('u-feel', 'Fixture carer')`;
      await olderDb.$executeRaw`INSERT INTO [Space] ([id], [name], [timezone]) VALUES ('s-feel', 'Fixture space', 'Europe/Copenhagen')`;
      await olderDb.$executeRaw`INSERT INTO [Food] ([id], [spaceId], [name], [nameSearch], [portions], [origin], [sourceRef], [updatedAt])
        VALUES ('f-feel', 's-feel', 'Fixture loaf', 'fixture loaf', '[]', 'family', 'family:f-feel', '2026-10-01T10:00:00')`;
      await olderDb.$executeRaw`INSERT INTO [Meal] ([id], [spaceId], [ts], [byUserId], [totalCarbs], [updatedAt])
        VALUES ('m-feel', 's-feel', '2026-10-01T12:00:00', 'u-feel', 18, '2026-10-01T12:00:00')`;
      await olderDb.$executeRaw`INSERT INTO [MealItem] ([id], [mealId], [foodId], [name], [carbs], [position])
        VALUES ('i-feel', 'm-feel', 'f-feel', 'Fixture loaf', 18, 0)`;

      migrate(older.url);

      const applied = await olderDb.$queryRaw<{ migration_name: string }[]>`
        SELECT migration_name FROM _prisma_migrations
        WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
      expect(applied.map((row) => row.migration_name).sort()).toEqual([
        "0001_foundation",
        "0002_food",
        "0003_ai",
        "0004_theme",
        "0005_feel",
      ]);
      const space = await olderDb.space.findUniqueOrThrow({ where: { id: "s-feel" } });
      expect(space.symptomKinds).toBe("[]");
      const food = await olderDb.food.findUniqueOrThrow({ where: { id: "f-feel" } });
      expect(food).toMatchObject({ name: "Fixture loaf", category: null, recipe: null });
      const meal = await olderDb.meal.findUniqueOrThrow({
        where: { id: "m-feel" },
        include: { items: true },
      });
      expect(meal.symbol).toBeNull();
      expect(meal.items.map((item) => item.carbs)).toEqual([18]);
      const symptom = await olderDb.symptom.create({
        data: { spaceId: "s-feel", byUserId: "u-feel", ts: new Date(), kind: "tired" },
      });
      expect(symptom.severity).toBeNull();
      const index = await olderDb.$queryRaw<{ name: string }[]>`
        SELECT name FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.Symptom')`;
      expect(index.map((row) => row.name)).toContain("Symptom_spaceId_ts_idx");
      expect(await schemaDiff(older.url, olderDb)).not.toMatch(/CREATE|ALTER|DROP/);
    } finally {
      await olderDb.$disconnect();
      await older.drop();
    }
  });

  it("stores each reading once however often, and however concurrently, the cycle runs", async () => {
    const spaceId = await newSpace("Integration readings");
    await withFakeSource(spaceId);
    const at = new Date("2026-10-15T12:02:00Z");

    const [first] = await cycle(spaceId, at);
    expect(first?.outcome).toBe("ok");
    expect(first?.stored).toBeGreaterThan(200);
    const afterFirst = await counts(spaceId);
    expect(afterFirst.readings).toBe(first?.stored);

    const [again] = await cycle(spaceId, at);
    expect(again?.stored).toBe(0);
    expect(await counts(spaceId)).toEqual(afterFirst);

    // Two overlapping cycles half an hour later: the primary key decides, one event per row.
    const later = new Date(at.getTime() + 30 * 60_000);
    const both = await Promise.all([cycle(spaceId, later), cycle(spaceId, later)]);
    const storedByBoth = both.flat().reduce((sum, outcome) => sum + outcome.stored, 0);
    expect(storedByBoth).toBe(6);
    const final = await counts(spaceId);
    expect(final.readings).toBe(afterFirst.readings + 6);
    expect(final.readingEvents).toBe(final.readings);
  });

  it("gives 20 concurrent emits the sequence numbers 1 to 20", async () => {
    const spaceId = await newSpace("Integration seq");
    const emit = createEmit({ db, sink: new MemoryEventSink() });

    const envelopes = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        emit(spaceId, "space.updated", { fields: [`field${String(i)}`] }),
      ),
    );

    const expected = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(envelopes.map((e) => e.seq).sort((a, b) => a - b)).toEqual(expected);
    const rows = await db.event.findMany({ where: { spaceId }, orderBy: { seq: "asc" } });
    expect(rows.map((row) => row.seq)).toEqual(expected);
    const space = await db.space.findUniqueOrThrow({ where: { id: spaceId } });
    expect(space.lastSeq).toBe(20);
  });

  it("never returns a reading row to a viewer, while the cursor still passes it", async () => {
    const spaceId = await newSpace("Integration viewer");
    const emit = createEmit({ db, sink: new MemoryEventSink() });
    await emit(spaceId, "member.joined", { userId: "viewer-user", role: "viewer" });
    await emit(spaceId, "reading", { ts: "2026-10-15T12:00:00.000Z", mmol: 6.2, trend: "flat" });
    await emit(spaceId, "source.status", {
      status: "connected",
      since: "2026-10-15T12:00:00.000Z",
    });
    await emit(spaceId, "reading", { ts: "2026-10-15T12:05:00.000Z", mmol: 6.4, trend: "flat" });

    const { loadEventsPage } = (await import(LIVE_SERVER)) as EventsPageModule;
    const viewer = await loadEventsPage(spaceId, 0, "viewer", db);
    expect(viewer.events.map((e) => e.type)).toEqual(["member.joined", "source.status"]);
    expect(viewer.lastSeq).toBe(4);

    const carer = await loadEventsPage(spaceId, 0, "carer", db);
    expect(carer.events.map((e) => e.type)).toEqual([
      "member.joined",
      "reading",
      "source.status",
      "reading",
    ]);
  });
});

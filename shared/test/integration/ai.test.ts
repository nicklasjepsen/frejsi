import { readdirSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, expect, it } from "vitest";
import { PrismaInsightRepository } from "../../src/insights/store";
import { PrismaFoodRepository } from "../../src/food/repository";
import { SCHEMA, createEmptyDatabase, migrate, prismaCli, type ScratchDatabase } from "./database";

let scratch: ScratchDatabase;
let db: PrismaClient;
beforeAll(async () => {
  scratch = await createEmptyDatabase("frejsi_ai_it");
  db = new PrismaClient({ datasourceUrl: `${scratch.url};connectionLimit=12` });
});
afterAll(async () => {
  await db.$disconnect();
  await scratch.drop();
});
it("applies the AI migration on top of the foundation and food migrations at compatibility 170", async () => {
  for (const migration of ["0001_foundation", "0002_food"]) {
    prismaCli(
      [
        "db",
        "execute",
        "--file",
        path.join(path.dirname(SCHEMA), `migrations/${migration}/migration.sql`),
        "--schema",
        SCHEMA,
      ],
      scratch.url,
    );
    prismaCli(["migrate", "resolve", "--applied", migration, "--schema", SCHEMA], scratch.url);
  }
  expect(await db.food.count()).toBe(0);
  migrate(scratch.url);
  const level = await db.$queryRaw<
    { compatibility_level: number }[]
  >`SELECT compatibility_level FROM sys.databases WHERE name = DB_NAME()`;
  expect(level[0]?.compatibility_level).toBe(170);
  expect(await db.insight.count()).toBe(0);
  const applied = await db.$queryRaw<
    { migration_name: string }[]
  >`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name`;
  // Every migration in the folder is applied, so a new one never needs this test edited.
  const onDisk = readdirSync(path.join(path.dirname(SCHEMA), "migrations"), {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  expect(applied.map((row) => row.migration_name)).toEqual(onDisk);
});
const vector = (a: number, b = 0) => [a, b, ...Array<number>(1022).fill(0)];
it("round-trips 1024 dimensions, orders cosine matches, filters model and space, and rejects 1536 dimensions in SQL", async () => {
  const space = await db.space.create({
    data: { name: "Fictional vector checks", timezone: "UTC" },
  });
  const other = await db.space.create({
    data: { name: "Fictional other library", timezone: "UTC" },
  });
  const rows = await Promise.all(
    ["near", "middle", "far", "other-model", "other-space"].map((name, i) =>
      db.food.create({
        data: {
          name,
          nameSearch: name,
          sourceRef: `family:${name}`,
          spaceId: i === 4 ? other.id : space.id,
          origin: "family",
          portions: JSON.stringify([{ label: "1 bowl", carbs: 20 }]),
          verified: i === 0,
        },
      }),
    ),
  );
  const first = rows[0];
  const middle = rows[1];
  if (!first || !middle) throw new Error("missing vector fixtures");
  const repo = new PrismaFoodRepository(db);
  await repo.setEmbeddings(
    rows.map((row, i) => ({
      id: row.id,
      vector: [vector(1), vector(1, 1), vector(0, 1), vector(1), vector(1)][i] ?? vector(1),
      model: i === 3 ? "other:model" : "fake:fixture",
    })),
  );
  const roundtrip = await db.$queryRaw<
    { embedding: string }[]
  >`SELECT CAST(embedding AS NVARCHAR(MAX)) AS embedding FROM Food WHERE id = ${middle.id}`;
  expect(JSON.parse(roundtrip[0]?.embedding ?? "null")).toEqual(vector(1, 1));
  const hits = await repo.searchLibrarySemantic(space.id, vector(1), "fake:fixture", 20);
  expect(hits.map((hit) => hit.food.id)).toEqual(rows.slice(0, 3).map((row) => row.id));
  expect(hits.map((hit) => hit.distance)).toEqual([0, expect.closeTo(1 - 1 / Math.sqrt(2), 5), 1]);
  expect(
    (
      await repo.searchLibrarySemantic(space.id, vector(1), "fake:fixture", 20, {
        verifiedOnly: true,
      })
    ).map((hit) => hit.food.id),
  ).toEqual([first.id]);
  await expect(
    db.$executeRaw`UPDATE Food SET embedding = CAST(${JSON.stringify(Array<number>(1536).fill(1))} AS vector(1536)) WHERE id = ${first.id}`,
  ).rejects.toThrow();
  expect(
    (await repo.searchLibrarySemantic(space.id, vector(1), "fake:fixture", 1))[0]?.food.id,
  ).toBe(first.id);
});
it("deduplicates ten concurrent Insight upserts on the compound key", async () => {
  const space = await db.space.create({
    data: { name: "Fictional insight checks", timezone: "UTC" },
  });
  const data = {
    spaceId: space.id,
    kind: "week",
    subjectKey: "2026-10-12",
    statsHash: "fixture",
    text: "Fictional weekly observation.",
    provider: "fake",
    model: "fixture",
  };
  const repo = new PrismaInsightRepository(db);
  const rows = await Promise.all(
    Array.from({ length: 10 }, () =>
      repo.save({ ...data, kind: "week", questions: [], rejectedCount: 0 }),
    ),
  );
  expect(new Set(rows.map((row) => row.id)).size).toBe(1);
  expect(await db.insight.count({ where: { spaceId: space.id } })).toBe(1);
});
it("deduplicates PushSubscription by user and endpoint and cascades from Session", async () => {
  const space = await db.space.create({ data: { name: "Fictional push checks", timezone: "UTC" } });
  const user = await db.user.create({ data: { name: "Fictional recipient" } });
  const session = await db.session.create({
    data: { id: "fixture-session", userId: user.id, expiresAt: new Date("2027-01-01") },
  });
  const data = {
    userId: user.id,
    spaceId: space.id,
    sessionId: session.id,
    endpoint: "https://push.example.test/fictional",
    p256dh: "fixture",
    auth: "fixture",
  };
  const first = await db.pushSubscription.create({ data });
  await expect(db.pushSubscription.create({ data })).rejects.toThrow();
  expect(await db.pushSubscription.count({ where: { userId: user.id } })).toBe(1);
  expect(
    (
      await db.pushSubscription.findUniqueOrThrow({
        where: { userId_endpoint: { userId: user.id, endpoint: data.endpoint } },
      })
    ).id,
  ).toBe(first.id);
  await db.session.delete({ where: { id: session.id } });
  expect(await db.pushSubscription.count({ where: { userId: user.id } })).toBe(0);
});

// Symptoms against a real SQL Server (v0.6.0 plan §5, task 3): the range query the routes and the
// curve read is inclusive at both bounds, ordered by `ts`, and never crosses into another space;
// a write and its event land in one transaction. Fictional people throughout.
// `pnpm --filter ./shared test:integration` with `DATABASE_URL`; release.yml only.
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MemoryEventSink } from "../../src/events/memory";
import { createEmptyDatabase, migrate, type ScratchDatabase } from "./database";

/** The web app's symptom repository and writer, loaded from web/src through the `@` alias. */
interface RepositoryModule {
  PrismaSymptomRepository: new (db: PrismaClient) => {
    range(spaceId: string, from: string, to: string): Promise<{ id: string; ts: string; byName: string }[]>;
    spaceKinds(spaceId: string): Promise<{ id: string }[] | null>;
  };
}
interface TransactionModule {
  createSymptomWriter: (
    db: PrismaClient,
    sink: MemoryEventSink,
  ) => <T>(
    work: (
      repo: {
        create(data: {
          id: string;
          spaceId: string;
          byUserId: string;
          ts: string;
          kind: string;
        }): Promise<{ id: string }>;
      },
      emit: (spaceId: string, type: "symptom.created", payload: unknown) => Promise<unknown>,
    ) => Promise<T>,
  ) => Promise<T>;
}
const REPOSITORY = "@/lib/symptoms/repository";
const TRANSACTION = "@/lib/symptoms/transaction";

const NOW = new Date("2026-10-15T13:00:00.000Z");
const at = (minutesAgo: number) => new Date(NOW.getTime() - minutesAgo * 60_000);

let scratch: ScratchDatabase;
let db: PrismaClient;
let repository: RepositoryModule;
let transaction: TransactionModule;
let spaces: { mine: string; other: string };
let child: string;

beforeAll(async () => {
  scratch = await createEmptyDatabase("frejsi_symptom_it");
  migrate(scratch.url);
  db = new PrismaClient({ datasourceUrl: scratch.url });
  repository = (await import(REPOSITORY)) as RepositoryModule;
  transaction = (await import(TRANSACTION)) as TransactionModule;
  const [mine, other] = await Promise.all([
    db.space.create({
      data: {
        name: "Fictional room",
        timezone: "Europe/Copenhagen",
        symptomKinds: JSON.stringify([{ id: "custom:itchy", label: { da: "Kloe", en: "Itchy" } }]),
      },
    }),
    db.space.create({ data: { name: "Other fictional room", timezone: "Europe/Copenhagen" } }),
  ]);
  spaces = { mine: mine.id, other: other.id };
  child = (await db.user.create({ data: { name: "Fictional child", simpleMode: true } })).id;
  const rows = [
    { spaceId: mine.id, ts: at(90), kind: "tired" },
    { spaceId: mine.id, ts: at(60), kind: "dizzy" },
    { spaceId: mine.id, ts: at(30), kind: "nausea" },
    { spaceId: mine.id, ts: at(0), kind: "shaky" },
    { spaceId: other.id, ts: at(45), kind: "headache" },
  ];
  for (const row of rows) await db.symptom.create({ data: { ...row, byUserId: child } });
});
afterAll(async () => {
  await db.$disconnect();
  await scratch.drop();
});

describe("symptoms on SQL Server", () => {
  it("returns the rows between the bounds inclusive, ordered by ts, from the requested space only", async () => {
    const repo = new repository.PrismaSymptomRepository(db);
    const rows = await repo.range(spaces.mine, at(60).toISOString(), at(30).toISOString());
    expect(rows.map((r) => r.ts)).toEqual([at(60).toISOString(), at(30).toISOString()]);
    expect(rows.every((r) => r.byName === "Fictional child")).toBe(true);
    const all = await repo.range(spaces.mine, at(24 * 60).toISOString(), NOW.toISOString());
    expect(all.map((r) => r.ts)).toEqual([at(90), at(60), at(30), at(0)].map((d) => d.toISOString()));
    const other = await repo.range(spaces.other, at(24 * 60).toISOString(), NOW.toISOString());
    expect(other).toHaveLength(1);
    expect(await repo.range(spaces.mine, at(29).toISOString(), at(1).toISOString())).toEqual([]);
  });
  it("reads the space's own kinds from the JSON column", async () => {
    const repo = new repository.PrismaSymptomRepository(db);
    expect(await repo.spaceKinds(spaces.mine)).toEqual([
      { id: "custom:itchy", label: { da: "Kloe", en: "Itchy" } },
    ]);
    expect(await repo.spaceKinds(spaces.other)).toEqual([]);
  });
  it("writes the row and its symptom.created in one transaction and publishes after commit", async () => {
    const sink = new MemoryEventSink();
    const write = transaction.createSymptomWriter(db, sink);
    const id = "fictional-symptom-1";
    await write(async (repo, emit) => {
      await repo.create({ id, spaceId: spaces.mine, byUserId: child, ts: at(5).toISOString(), kind: "tired" });
      await emit(spaces.mine, "symptom.created", {
        symptomId: id,
        ts: at(5).toISOString(),
        kind: "tired",
        byUserId: child,
      });
    });
    const events = await db.event.findMany({ where: { spaceId: spaces.mine }, orderBy: { seq: "asc" } });
    expect(events.map((e) => e.type)).toEqual(["symptom.created"]);
    expect(await db.symptom.count({ where: { id } })).toBe(1);
    expect(sink.published.map((p) => p.envelope.type)).toEqual(["symptom.created"]);
    // A failing event rolls the row back with it.
    await expect(
      write(async (repo) => {
        await repo.create({ id: "fictional-symptom-2", spaceId: spaces.mine, byUserId: child, ts: at(4).toISOString(), kind: "dizzy" });
        throw new Error("transient");
      }),
    ).rejects.toThrow("transient");
    expect(await db.symptom.count({ where: { id: "fictional-symptom-2" } })).toBe(0);
    expect(await db.event.count({ where: { spaceId: spaces.mine } })).toBe(1);
  });
});

import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { PrismaAiCallRepository, type AiCallDb } from "./calls-prisma";
import type { AiCallRow, ReserveAiCall } from "./calls";

const ts = new Date("2026-10-15T10:00:00Z");
const input: ReserveAiCall = {
  spaceId: "s1",
  from: new Date("2026-10-14T22:00:00Z"),
  to: new Date("2026-10-15T22:00:00Z"),
  kinds: ["complete", "vision"],
  limit: 1,
  row: { spaceId: "s1", userId: "u1", kind: "complete", use: "parse", provider: "fake", ts },
};

it("adds the AI tables, native vector and session cascade in migration 0003", () => {
  const schema = readFileSync(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
  const migration = readFileSync(
    new URL("../../prisma/migrations/0003_ai/migration.sql", import.meta.url),
    "utf8",
  );
  expect(schema).toContain('Unsupported("vector(1024)")?');
  expect(schema).toContain("@@unique([spaceId, kind, subjectKey])");
  expect(schema).toContain("@@unique([userId, endpoint])");
  expect(migration).toMatch(/\[embedding\] vector\(1024\)/);
  for (const table of ["AiCall", "Insight", "PushSubscription"])
    expect(migration).toContain(`CREATE TABLE [dbo].[${table}]`);
  expect(migration).toMatch(
    /PushSubscription_sessionId_fkey.*REFERENCES \[dbo\]\.\[Session\]\(\[id\]\) ON DELETE CASCADE/,
  );
  expect(readFileSync(new URL("../../prisma/food.prisma", import.meta.url), "utf8")).not.toContain(
    "model AiCall",
  );
});

it("reserves and completes content-free attempts through serializable transactions, retrying conflicts", async () => {
  const rows: AiCallRow[] = [];
  let conflicts = 1;
  const aiCall: AiCallDb["aiCall"] = {
    count: (args) =>
      Promise.resolve(
        rows.filter(
          (row) =>
            row.spaceId === args.where.spaceId &&
            row.ts >= args.where.ts.gte &&
            row.ts < args.where.ts.lt &&
            args.where.kind.in.includes(row.kind),
        ).length,
      ),
    create: (args) => {
      const row = { ...args.data, id: String(rows.length + 1) };
      rows.push(row);
      return Promise.resolve({ id: row.id });
    },
    update: (args) => {
      const row = rows.find((row) => row.id === args.where.id);
      if (!row) throw new Error("Missing row");
      Object.assign(row, args.data);
      return Promise.resolve({ id: row.id });
    },
  };
  const db: AiCallDb = {
    aiCall,
    $transaction: async (work, options) => {
      expect(options).toEqual({ isolationLevel: "Serializable" });
      if (conflicts-- > 0) throw Object.assign(new Error("Conflict"), { code: "P2034" });
      return work({ aiCall });
    },
  };
  const repository = new PrismaAiCallRepository(db);
  const first = await repository.reserve(input);
  expect(first.allowed).toBe(true);
  await repository.finish(first.id, { model: "fixture", ok: true, ms: 12 });
  expect((await repository.reserve(input)).allowed).toBe(false);
  expect(await repository.count(input)).toBe(2);
  expect(rows).toEqual([
    { ...input.row, id: "1", model: "fixture", ok: true, ms: 12 },
    { ...input.row, id: "2", model: "", ok: false, ms: 0 },
  ]);
  expect(await repository.count({ ...input, spaceId: "other" })).toBe(0);
  expect(await repository.count({ ...input, from: ts, to: ts })).toBe(0);
});

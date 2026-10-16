import { EventEnvelope } from "../schemas/events";
import type { EmitFn } from "../events/emit";
import type { Prisma } from "@prisma/client";
import { expect, it, vi } from "vitest";
import { PrismaFoodRepository, type FoodDb } from "./repository";
it("uses one parameterised cosine query per tier with model, scope, verified filter and distance order", async () => {
  const queries: Prisma.Sql[] = [];
  const db = {
    $queryRaw: (sql: Prisma.Sql) => {
      queries.push(sql);
      return Promise.resolve([]);
    },
  } as unknown as FoodDb;
  const repo = new PrismaFoodRepository(db);
  const vector = Array<number>(1024).fill(1);
  await repo.searchLibrarySemantic("s1", vector, "test:model", 20, { verifiedOnly: true });
  await repo.searchCacheSemantic(vector, "test:model", 10);
  expect(queries).toHaveLength(2);
  for (const query of queries) {
    expect(query.sql).toContain("VECTOR_DISTANCE('cosine'");
    expect(query.sql).toContain("embeddingModel] = ?");
    expect(query.sql).toContain("ORDER BY [distance], [id]");
    expect(query.sql).toContain("TOP (?)");
    expect(query.values).toContain("test:model");
    expect(query.sql).not.toContain("test:model");
  }
  expect(queries[0]?.sql).toContain("[verified] = 1");
  expect(queries[0]?.values).toContain("s1");
  expect(queries[1]?.sql).toContain("[spaceId] IS NULL");
});
it("writes vectors with a model and guards against a concurrent rename", async () => {
  const execute = vi.fn().mockResolvedValue(1);
  const repo = new PrismaFoodRepository({ $executeRaw: execute } as unknown as FoodDb);
  await repo.setEmbeddings([
    { id: "a", name: "Pear", vector: Array<number>(1024).fill(1), model: "test:model" },
  ]);
  const sql = execute.mock.calls[0]?.[0] as Prisma.Sql;
  expect(sql.sql).toContain("CAST(? AS vector(1024))");
  expect(sql.sql).toContain("[name] = ?");
  expect(sql.values).toContain("Pear");
});

it.each([false, true])(
  "commits food.updated atomically and preserves existing verification (%s)",
  async (verified) => {
    const { Food } = await import("../schemas/food");
    const input = Food.parse({
      id: "a",
      spaceId: "s1",
      origin: "remote-test",
      sourceRef: "remote-test:a",
      name: "EXAMPLE LOAF 900G",
      nameSearch: "example loaf 900g",
      carbsPer100g: 40,
      portions: [{ label: "slice", grams: 45, carbs: 18 }],
      verified,
      verifiedBy: "u1",
      createdAt: "2026-10-15T12:00:00Z",
      updatedAt: "2026-10-15T12:00:00Z",
    });
    let stored = {
      ...input,
      portions: JSON.stringify(input.portions),
      sourceName: null as string | null,
    };
    let failEvent = true;
    const published: unknown[] = [];
    const statements: Prisma.Sql[] = [];
    const tx = {
      $executeRaw: (sql: Prisma.Sql) => {
        statements.push(sql);
        stored.name = String(sql.values[0]);
        stored.sourceName = String(sql.values[2]);
        return Promise.resolve(1);
      },
      space: { update: () => Promise.resolve({ lastSeq: 1 }) },
      event: {
        create: () => {
          if (failEvent) throw new Error("event failure");
          return Promise.resolve({});
        },
      },
    };
    const db = {
      food: { findMany: () => Promise.resolve([{ ...stored }]) },
      $executeRaw: tx.$executeRaw,
      $transaction: async (run: (tx: unknown) => Promise<void>) => {
        const before = structuredClone(stored);
        try {
          await run(tx);
        } catch (error) {
          stored = before;
          throw error;
        }
      },
    } as unknown as FoodDb;
    const repo = new PrismaFoodRepository(db, {
      publish: (_group, event) => {
        published.push(event);
        return Promise.resolve();
      },
    });
    const emit: EmitFn = (spaceId, type, payload) =>
      Promise.resolve(
        EventEnvelope.parse({ spaceId, type, payload, seq: 1, ts: "2026-10-15T12:00:00Z" }),
      );
    await expect(
      repo.setNormalisedName(input, { name: "Example loaf", portions: [] }, ["s1"], emit),
    ).rejects.toThrow("event failure");
    expect(stored.name).toBe(input.name);
    expect(published).toEqual([]);
    failEvent = false;
    await repo.setNormalisedName(input, { name: "Example loaf", portions: [] }, ["s1"], emit);
    expect(stored).toMatchObject({
      name: verified ? input.name : "Example loaf",
      sourceName: input.name,
      verified,
      verifiedBy: "u1",
    });
    expect(published).toEqual([
      expect.objectContaining({ spaceId: "s1", type: "food.updated", payload: { foodId: "a" } }),
    ]);
    for (const sql of statements) {
      expect(sql.sql.split("WHERE")[0]).not.toMatch(/verified/);
      expect(sql.sql).toContain("AND [verified] = ?");
      expect(sql.sql).toContain("[name] = ? AND [portions] = ? AND [sourceName] IS NULL");
      expect(sql.values).toContain(JSON.stringify(input.portions));
    }
  },
);

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

it("persists a candidate's category in the cache and reads category and recipe back (v0.6.0)", async () => {
  const at = new Date("2026-10-15T12:00:00Z");
  const recipe = {
    ingredients: [{ name: "Fictional flour", carbs: 360 }],
    yieldPortions: 4,
    source: { kind: "text", text: "flour" },
  };
  const base = {
    id: "cache-1",
    spaceId: null,
    name: "Fictional loaf",
    nameSearch: "fictional loaf",
    embeddingModel: null,
    sourceName: null,
    carbsPer100g: null,
    portions: "[]",
    barcode: null,
    photoKey: null,
    origin: "remote-test",
    sourceRef: "remote-test:loaf",
    category: null,
    recipe: null,
    verified: false,
    verifiedBy: null,
    verifiedAt: null,
    favourite: false,
    createdBy: null,
    createdAt: at,
    updatedAt: at,
  };
  const created: unknown[] = [];
  const db = {
    food: {
      findFirst: () => Promise.resolve(null),
      findMany: () =>
        Promise.resolve([
          { ...base, id: "f-null" },
          { ...base, id: "f-full", category: "bread", recipe: JSON.stringify(recipe) },
        ]),
      create: (args: { data: Record<string, unknown> }) => {
        created.push(args.data);
        return Promise.resolve({
          ...base,
          category: (args.data.category as string | undefined) ?? null,
        });
      },
      update: () => Promise.reject(new Error("unexpected")),
    },
  } as unknown as FoodDb;
  const repo = new PrismaFoodRepository(db);
  const withCategory = await repo.upsertCache({
    name: "Fictional loaf",
    portions: [],
    origin: "remote-test",
    sourceRef: "remote-test:loaf",
    category: "bread",
    spaceId: null,
    verified: false,
  });
  expect(withCategory.category).toBe("bread");
  expect(created[0]).toMatchObject({ category: "bread" });
  await repo.upsertCache({
    name: "Fictional loaf",
    portions: [],
    origin: "remote-test",
    sourceRef: "remote-test:loaf",
    spaceId: null,
    verified: false,
  });
  expect(created[1]).not.toHaveProperty("category");
  const [plain, full] = await repo.searchCache("loaf");
  expect(plain?.category).toBeUndefined();
  expect(plain?.recipe).toBeUndefined();
  expect(full).toMatchObject({ category: "bread", recipe });
});

it("keeps a cache row's category on upsert unless the new candidate names one (v0.6.0 plan §7)", async () => {
  const updates: Record<string, unknown>[] = [];
  const base = {
    id: "cache-1",
    spaceId: null,
    name: "Fictional loaf",
    nameSearch: "fictional loaf",
    embeddingModel: null,
    sourceName: null,
    carbsPer100g: null,
    portions: "[]",
    barcode: null,
    photoKey: null,
    origin: "remote-test",
    sourceRef: "remote-test:loaf",
    category: "bread",
    recipe: null,
    verified: false,
    verifiedBy: null,
    verifiedAt: null,
    favourite: false,
    createdBy: null,
    createdAt: new Date("2026-10-15T12:00:00Z"),
    updatedAt: new Date("2026-10-15T12:00:00Z"),
  };
  const db = {
    food: {
      findFirst: () => Promise.resolve(base),
      findMany: () => Promise.resolve([]),
      create: () => Promise.reject(new Error("unexpected")),
      update: (args: { data: Record<string, unknown> }) => {
        updates.push(args.data);
        return Promise.resolve({ ...base, ...args.data });
      },
    },
  } as unknown as FoodDb;
  const repo = new PrismaFoodRepository(db);
  const candidate = {
    name: "Fictional loaf",
    portions: [],
    origin: "remote-test",
    sourceRef: "remote-test:loaf",
    spaceId: null,
    verified: false as const,
  };
  expect((await repo.upsertCache(candidate)).category).toBe("bread");
  expect(updates[0]).not.toHaveProperty("category");
  expect(updates[0]).not.toHaveProperty("verified", true);
  expect((await repo.upsertCache({ ...candidate, category: "snack" })).category).toBe("snack");
  expect(updates[1]).toMatchObject({ category: "snack", verified: false });
});

it("lists foods without a category, cache first, never a recipe, bounded (v0.6.0 plan §7)", async () => {
  const args: unknown[] = [];
  const db = {
    food: {
      findMany: (query: unknown) => {
        args.push(query);
        return Promise.resolve([]);
      },
    },
  } as unknown as FoodDb;
  const repo = new PrismaFoodRepository(db);
  expect(await repo.categoryCandidates(["s1", "s2"], 50, true)).toEqual([]);
  expect(args[0]).toEqual({
    where: {
      category: null,
      origin: { notIn: ["recipe"] },
      OR: [{ spaceId: null }, { spaceId: { in: ["s1", "s2"] } }],
    },
    orderBy: [{ spaceId: "asc" }, { id: "asc" }],
    take: 50,
  });
  await repo.categoryCandidates(["s1"], 10, false);
  expect(args[1]).toMatchObject({ where: { OR: [{ spaceId: { in: ["s1"] } }] }, take: 10 });
});

it.each([false, true])(
  "setCategory writes only the category, into every unplaced copy, with food.updated in the same transaction (verified %s)",
  async (verified) => {
    const { Food } = await import("../schemas/food");
    const input = Food.parse({
      id: "a",
      spaceId: "s1",
      origin: "remote-test",
      sourceRef: "remote-test:a",
      name: "Example loaf",
      nameSearch: "example loaf",
      carbsPer100g: 40,
      portions: [{ label: "slice", grams: 45, carbs: 18 }],
      verified,
      verifiedBy: "u1",
      createdAt: "2026-10-15T12:00:00Z",
      updatedAt: "2026-10-15T12:00:00Z",
    });
    const stored = [
      { ...input, portions: JSON.stringify(input.portions), category: null as string | null },
      {
        ...input,
        id: "cache",
        spaceId: null,
        portions: JSON.stringify(input.portions),
        category: null as string | null,
      },
    ];
    let failEvent = true;
    const published: unknown[] = [];
    const statements: Prisma.Sql[] = [];
    const where: unknown[] = [];
    const executeRaw = (sql: Prisma.Sql) => {
      statements.push(sql);
      const target = stored.find((row) => row.id === sql.values[2]);
      if (target) target.category = String(sql.values[0]);
      return Promise.resolve(1);
    };
    const tx = {
      $executeRaw: executeRaw,
      space: { update: () => Promise.resolve({ lastSeq: 1 }) },
      event: {
        create: () => {
          if (failEvent) throw new Error("event failure");
          return Promise.resolve({});
        },
      },
    };
    const db = {
      food: {
        findMany: (query: { where: unknown }) => {
          where.push(query.where);
          return Promise.resolve(stored.map((row) => ({ ...row })));
        },
      },
      $executeRaw: executeRaw,
      $transaction: async (run: (tx: unknown) => Promise<void>) => {
        const before = structuredClone(stored);
        try {
          await run(tx);
        } catch (error) {
          stored.splice(0, stored.length, ...before);
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
    await expect(repo.setCategory(input, "bread", ["s1"], emit)).rejects.toThrow("event failure");
    expect(stored[0]?.category).toBeNull();
    expect(published).toEqual([]);
    failEvent = false;
    await repo.setCategory(input, "bread", ["s1"], emit);
    expect(stored.map((row) => row.category)).toEqual(["bread", "bread"]);
    expect(stored.map((row) => row.verified)).toEqual([verified, verified]);
    expect(stored.map((row) => row.name)).toEqual([input.name, input.name]);
    expect(published).toEqual([
      expect.objectContaining({ spaceId: "s1", type: "food.updated", payload: { foodId: "a" } }),
    ]);
    expect(where[0]).toEqual({
      origin: input.origin,
      sourceRef: input.sourceRef,
      category: null,
      OR: [{ id: input.id }, { spaceId: { in: ["s1"] } }],
    });
    for (const sql of statements) {
      const set = sql.sql.split("WHERE")[0] ?? "";
      expect(set).toMatch(/SET \[category\] = \?, \[updatedAt\] = \?/);
      expect(set).not.toMatch(/verified|\[name\]|portions|sourceName/);
      expect(sql.sql).toContain("[category] IS NULL");
      expect(sql.values[0]).toBe("bread");
    }
  },
);

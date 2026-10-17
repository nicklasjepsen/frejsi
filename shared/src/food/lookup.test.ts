import { readFileSync } from "node:fs";

import { Prisma, type Food as FoodRow } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Food, type FoodCandidate } from "../schemas/food";
import { FakeFoodSource } from "./fake";
import { lookup } from "./lookup";
import { MemoryFoodRepository } from "./memory";
import { foodSources, registerFoodSource } from "./registry";
import { PrismaFoodRepository, type FoodDb } from "./repository";
import { foldForSearch } from "./search";
import { CacheFoodInput, type FoodSource } from "./types";

const barcode = "2000000000008";
const candidate = (name = "Example loaf", origin = "fake-remote"): FoodCandidate => ({
  name,
  carbsPer100g: 40,
  portions: [],
  origin,
  sourceRef: `${origin}:${name}`,
});
const row = (id: string, overrides: Partial<Food> = {}): Food =>
  Food.parse({
    ...candidate(),
    id,
    sourceRef: `manual:${id}`,
    origin: "manual",
    nameSearch: "example loaf",
    spaceId: "s1",
    createdAt: "2026-10-14T08:00:00.000Z",
    updatedAt: "2026-10-14T08:00:00.000Z",
    ...overrides,
  });
const options = {
  spaceId: "s1",
  session: { simpleMode: false },
  query: { q: "example" },
  locale: "en",
} as const;
const plugins = () => [
  new FakeFoodSource({ id: "fake-remote", kind: "remote", candidates: [candidate()] }),
  new FakeFoodSource({
    id: "fake-local",
    kind: "local",
    candidates: [candidate("Example local", "fake-local")],
  }),
];

afterEach(() => {
  vi.useRealTimers();
});

describe("Prisma food repository", () => {
  const dbRow = (overrides: Partial<FoodRow> = {}): FoodRow => ({
    id: "cache-1",
    spaceId: null,
    name: "Example loaf",
    nameSearch: "example loaf",
    carbsPer100g: new Prisma.Decimal("40.1"),
    portions: '[{"label":"slice","carbs":18}]',
    barcode: null,
    photoKey: null,
    sourceName: null,
    embeddingModel: null,
    origin: "fake-remote",
    sourceRef: "fake-remote:1",
    category: null,
    recipe: null,
    verified: false,
    verifiedBy: null,
    verifiedAt: null,
    favourite: false,
    createdBy: null,
    createdAt: new Date("2026-10-14T08:00:00Z"),
    updatedAt: new Date("2026-10-14T08:00:00Z"),
    ...overrides,
  });
  const database = () => ({
    food: {
      findMany: vi.fn<FoodDb["food"]["findMany"]>().mockResolvedValue([dbRow()]),
      findFirst: vi.fn<FoodDb["food"]["findFirst"]>().mockResolvedValue(null),
      create: vi.fn<FoodDb["food"]["create"]>().mockResolvedValue(dbRow()),
      update: vi.fn<FoodDb["food"]["update"]>().mockResolvedValue(dbRow()),
    },
  });
  it("maps Decimal, dates, JSON and nullable database columns into the contract", async () => {
    const repo = new PrismaFoodRepository(database());
    const rows = await repo.searchCache("example");
    expect(rows[0]).toMatchObject({
      carbsPer100g: 40.1,
      portions: [{ label: "slice", carbs: 18 }],
      updatedAt: "2026-10-14T08:00:00.000Z",
      spaceId: null,
      verified: false,
    });
    expect(Food.safeParse(rows[0]).success).toBe(true);
  });
  it("hydrates creator provenance from library database rows", async () => {
    const db = database();
    db.food.findMany.mockResolvedValue([
      {
        ...dbRow({ spaceId: "s1", createdBy: "u1", sourceName: "ORIGINAL LOAF" }),
        creator: { id: "u1", name: "Example maker" },
      },
    ]);
    const result = await lookup(new PrismaFoodRepository(db), [], options);
    expect(result.results[0]?.food).toMatchObject({
      createdAt: "2026-10-14T08:00:00.000Z",
      sourceName: "ORIGINAL LOAF",
      createdBy: { id: "u1", name: "Example maker" },
    });
  });
  it("bounds SQL reads, folds every query word and excludes library copies before taking cache rows", async () => {
    const db = database();
    const repo = new PrismaFoodRepository(db);
    await repo.searchLibrary("s1", "Crème brûlée", { verifiedOnly: true });
    expect(db.food.findMany).toHaveBeenLastCalledWith({
      where: {
        spaceId: "s1",
        verified: true,
        AND: [{ nameSearch: { contains: "creme" } }, { nameSearch: { contains: "brulee" } }],
      },
      include: { creator: { select: { id: true, name: true } } },
      orderBy: [{ favourite: "desc" }, { verified: "desc" }, { name: "asc" }, { id: "asc" }],
      take: 20,
    });
    await repo.searchCache("example", ["fake-remote:1"]);
    expect(db.food.findMany).toHaveBeenLastCalledWith({
      where: {
        spaceId: null,
        AND: [{ nameSearch: { contains: "example" } }],
        sourceRef: { notIn: ["fake-remote:1"] },
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: 10,
    });
    await repo.findLibraryByBarcode("s1", barcode, { verifiedOnly: true });
    expect(db.food.findMany.mock.lastCall?.[0].where).toEqual({
      spaceId: "s1",
      barcode,
      verified: true,
    });
    await repo.findCacheByBarcode(barcode, ["fake-remote:1"]);
    expect(db.food.findMany.mock.lastCall?.[0].where).toEqual({
      spaceId: null,
      barcode,
      sourceRef: { notIn: ["fake-remote:1"] },
    });
  });
  it("serialises only an unverified cache row and updates an existing cache row", async () => {
    const db = database();
    const repo = new PrismaFoodRepository(db);
    const input = { ...candidate(), spaceId: null, verified: false } as const;
    const output = await repo.upsertCache(input);
    expect(output.verified).toBe(false);
    expect(db.food.create.mock.lastCall?.[0].data).toEqual({
      ...input,
      portions: "[]",
      barcode: null,
      nameSearch: "example loaf",
    });
    db.food.findFirst.mockResolvedValue(dbRow());
    await repo.upsertCache(input);
    expect(db.food.update.mock.lastCall?.[0].where).toEqual({ id: "cache-1" });
    expect(db.food.create).toHaveBeenCalledTimes(1);
    expect(CacheFoodInput.safeParse({ ...input, spaceId: "s1" }).success).toBe(false);
    expect(CacheFoodInput.safeParse({ ...input, verified: true }).success).toBe(false);
    expect(CacheFoodInput.safeParse({ ...input, createdBy: "u1" }).success).toBe(false);
  });
  it("recovers concurrent cache inserts through the SQL Server unique constraint", async () => {
    const db = database();
    db.food.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("duplicate", {
        code: "P2002",
        clientVersion: "6.19.3",
      }),
    );
    db.food.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(dbRow());
    const result = await new PrismaFoodRepository(db).upsertCache({
      ...candidate(),
      spaceId: null,
      verified: false,
    });
    expect(result.id).toBe("cache-1");
    expect(db.food.update.mock.lastCall?.[0].where).toEqual({ id: "cache-1" });
  });
  it("propagates database errors instead of returning a successful empty result", async () => {
    const db = database();
    db.food.create.mockRejectedValue(new Error("unavailable"));
    await expect(
      new PrismaFoodRepository(db).upsertCache({ ...candidate(), spaceId: null, verified: false }),
    ).rejects.toThrow("unavailable");
    db.food.findMany.mockRejectedValue(new Error("unavailable"));
    await expect(new PrismaFoodRepository(db).searchCache("example")).rejects.toThrow(
      "unavailable",
    );
  });
});

describe("configured source registry", () => {
  it("exposes configured sources through the food subpath", async () => {
    const food = await import("@frejsi/shared/food");
    expect(food.foodSources({})).toEqual([]);
    expect(food.registerFoodSource).toBe(registerFoodSource);
  });
  it("enables only the ids in configuration, in configuration order", () => {
    const [remote, local] = plugins();
    if (!remote || !local) throw new Error("Missing fakes");
    const unregisterRemote = registerFoodSource(remote.id, () => remote);
    const unregisterLocal = registerFoodSource(local.id, () => local);
    try {
      expect(foodSources({})).toEqual([]);
      expect(foodSources({ FOOD_SOURCES: "" })).toEqual([]);
      expect(foodSources({ FOOD_SOURCES: "fake-local" })).toEqual([local]);
      expect(foodSources({ FOOD_SOURCES: "fake-local, fake-remote" })).toEqual([local, remote]);
      expect(() => foodSources({ FOOD_SOURCES: "unknown" })).toThrow();
    } finally {
      unregisterRemote();
      unregisterLocal();
    }
  });
});

describe("lookup", () => {
  it("returns library provenance from the joined creator and retains absent attribution", async () => {
    const original = row("original", {
      sourceName: "EXAMPLE ORIGINAL LOAF",
      createdBy: "u1",
      creator: { id: "u1", name: "Example maker" },
    });
    const result = await lookup(new MemoryFoodRepository([original, row("legacy")]), [], options);
    const food = result.results.find((r) => "id" in r.food && r.food.id === "original")?.food;
    expect(food).toMatchObject({
      sourceName: original.sourceName,
      createdBy: { id: "u1", name: "Example maker" },
      createdAt: original.createdAt,
    });
    const legacy = result.results.find((r) => "id" in r.food && r.food.id === "legacy")?.food;
    expect(legacy).toMatchObject({ createdAt: original.createdAt });
    expect(legacy).toHaveProperty("createdBy", undefined);
  });

  it("carries a library or cache row's category into the lookup result (v0.6.0 plan §7)", async () => {
    const repo = new MemoryFoodRepository([
      row("own", { category: "bread" }),
      row("plain"),
      row("cache", { spaceId: null, sourceRef: "fake-remote:cache", category: "dairy" }),
    ]);
    const result = await lookup(repo, [], options);
    const byId = (id: string) =>
      result.results.find((r) =>
        "id" in r.food ? r.food.id === id : r.food.sourceRef.endsWith(id),
      );
    expect(byId("own")?.food.category).toBe("bread");
    expect(byId("plain")?.food.category).toBeUndefined();
    expect(byId("cache")?.food).toMatchObject({ category: "dairy" });
  });

  it("orders library, deduplicated cache, then plugins and pre-fills manual", async () => {
    const repo = new MemoryFoodRepository([
      row("normal", { name: "Example Z" }),
      row("verified", { name: "Example A", verified: true }),
      row("favourite", { name: "Example B", favourite: true }),
      row("other-space", { spaceId: "s2" }),
      row("cached-copy", { spaceId: null, sourceRef: "manual:verified" }),
      row("cache", { spaceId: null, sourceRef: "fake-remote:cache" }),
    ]);
    const result = await lookup(repo, plugins(), options);
    expect(result.results.map((r) => r.source)).toEqual([
      "library",
      "library",
      "library",
      "cache",
      "fake-remote",
      "fake-local",
    ]);
    expect(result.results.slice(0, 3).map((r) => "id" in r.food && r.food.id)).toEqual([
      "favourite",
      "verified",
      "normal",
    ]);
    expect(result.results[3]?.food).toHaveProperty("sourceRef", "fake-remote:cache");
    expect(result.manual).toEqual({ name: "example" });
    expect(result.sources).toEqual({ "fake-remote": "ok", "fake-local": "ok" });
    expect(repo.writes).toEqual([]);
  });

  it("matches every folded word, orders by name and applies caps after deduplication", async () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      row(`f${i}`, { name: `Example ${String(i).padStart(2, "0")} loaf` }),
    );
    const repo = new MemoryFoodRepository([
      ...rows,
      ...rows.map((r, i) => row(`c${i}`, { ...r, id: `c${i}`, spaceId: null })),
      ...Array.from({ length: 15 }, (_, i) => row(`new${i}`, { spaceId: null })),
    ]);
    const result = await lookup(repo, [], options);
    expect(result.results.filter((r) => r.source === "library")).toHaveLength(20);
    expect(result.results.filter((r) => r.source === "cache")).toHaveLength(10);
    expect(result.results[0]?.food.name).toBe("Example 00 loaf");
    const folded = new MemoryFoodRepository([
      row("fold", {
        name: "Crème brûlée example",
        nameSearch: foldForSearch("Crème brûlée example"),
      }),
      row("no", { nameSearch: "example cream" }),
    ]);
    expect(
      (await lookup(folded, [], { ...options, query: { q: "brulee creme" } })).results,
    ).toHaveLength(1);
  });

  it("searches library and cache from one character, sources only from three", async () => {
    const sources = plugins();
    const repo = new MemoryFoodRepository([row("one"), row("two", { spaceId: null })]);
    for (const q of ["e", "ex"]) {
      const result = await lookup(repo, sources, { ...options, query: { q } });
      expect(result.results.map((r) => r.source)).toEqual(["library", "cache"]);
      expect(result.sources).toEqual({ "fake-remote": "skipped", "fake-local": "skipped" });
    }
    expect(sources.flatMap((s) => s.calls)).toEqual([]);
  });

  it("skips only remote sources while typing", async () => {
    const sources = plugins();
    const result = await lookup(new MemoryFoodRepository(), sources, {
      ...options,
      query: { q: "example", remote: false },
    });
    expect(result.results.map((r) => r.source)).toEqual(["fake-local"]);
    expect(result.sources).toEqual({ "fake-remote": "skipped", "fake-local": "ok" });
    expect(sources[0]?.calls).toEqual([]);
  });

  it("simpleMode returns verified own-library foods only and never contacts cache or sources", async () => {
    const repo = new MemoryFoodRepository([
      row("checked", { verified: true }),
      row("unchecked", { favourite: true }),
      row("cache", { spaceId: null }),
      row("other", { spaceId: "s2", verified: true }),
    ]);
    const sources = plugins();
    const cacheSearch = vi.spyOn(repo, "searchCache");
    const result = await lookup(repo, sources, { ...options, session: { simpleMode: true } });
    expect(result.results.map((r) => "id" in r.food && r.food.id)).toEqual(["checked"]);
    expect(result.sources).toEqual({ "fake-remote": "skipped", "fake-local": "skipped" });
    expect(cacheSearch).not.toHaveBeenCalled();
    expect(sources.flatMap((s) => s.calls)).toEqual([]);
  });

  it("keeps healthy sources when another throws, times out or is rate-limited", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const never = () =>
      new Promise<never>(() => {
        /* Intentionally never settles, including on abort. */
      });
    const slow: FoodSource = {
      id: "slow",
      kind: "remote",
      search: (_q, _locale, abort) => {
        signal = abort;
        return never();
      },
      byBarcode: never,
    };
    const sources = [
      new FakeFoodSource({ id: "broken", kind: "remote", error: new Error("failure") }),
      slow,
      new FakeFoodSource({
        id: "limited",
        kind: "remote",
        status: "rate-limited",
        candidates: [candidate()],
      }),
      ...plugins(),
    ];
    const pending = lookup(new MemoryFoodRepository(), sources, options);
    await vi.advanceTimersByTimeAsync(2499);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;
    expect(signal?.aborted).toBe(true);
    expect(result.results.map((r) => r.source)).toEqual(["fake-remote", "fake-local"]);
    expect(result.sources).toEqual({
      broken: "error",
      slow: "timeout",
      limited: "rate-limited",
      "fake-remote": "ok",
      "fake-local": "ok",
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses only an unverified shared-cache upsert for remote barcode hits", async () => {
    const sources = plugins();
    const repo = new MemoryFoodRepository();
    const result = await lookup(repo, sources, { ...options, query: { barcode } });
    expect(result.manual).toEqual({ barcode });
    expect(repo.writes).toEqual([
      {
        method: "upsertCache",
        data: {
          ...candidate(),
          barcode,
          spaceId: null,
          verified: false,
          sourceRef: `fake-remote:${barcode}`,
        },
      },
    ]);
    expect(repo.rows[0]).toMatchObject({ spaceId: null, verified: false, origin: "fake-remote" });
    await lookup(repo, sources, { ...options, query: { barcode } });
    expect(repo.rows).toHaveLength(1);
    expect(sources[0]?.calls[0]).toEqual({ method: "byBarcode", barcode });
  });

  it.each([null, "s1"])(
    "prefers a barcode row in space %s over the same source candidate",
    async (spaceId) => {
      const repo = new MemoryFoodRepository([
        row("existing", { spaceId, barcode, sourceRef: `fake-remote:${barcode}` }),
      ]);
      const sources = plugins();
      const result = await lookup(repo, sources, { ...options, query: { barcode } });
      expect(result.results.map((item) => item.source)).toEqual([
        spaceId === null ? "cache" : "library",
        "fake-local",
      ]);
      expect(result.sources).toEqual({ "fake-remote": "skipped", "fake-local": "ok" });
      expect(sources[0]?.calls).toEqual([]);
      expect(repo.writes).toEqual([]);
    },
  );

  it("keeps the first remote barcode candidate in both the response and cache", async () => {
    const first = candidate("Example first loaf");
    const source = new FakeFoodSource({
      id: "fake-remote",
      kind: "remote",
      candidates: [first, candidate("Example second loaf")],
    });
    const repo = new MemoryFoodRepository();
    const result = await lookup(repo, [source], { ...options, query: { barcode } });
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.food.name).toBe(first.name);
    expect(repo.rows).toHaveLength(1);
    expect(repo.rows[0]?.name).toBe(first.name);
    expect(repo.writes).toHaveLength(1);

    const cached = await lookup(repo, [source], { ...options, query: { barcode } });
    expect(cached.results).toHaveLength(1);
    expect(cached.results[0]?.food).toEqual(result.results[0]?.food);
    expect(cached.sources).toEqual({ "fake-remote": "skipped" });
    expect(repo.writes).toHaveLength(1);
  });

  it("rejects an oversized folded source name before any cache write", async () => {
    const repo = new MemoryFoodRepository();
    const source = new FakeFoodSource({
      id: "fake-remote",
      kind: "remote",
      candidates: [{ ...candidate("æ".repeat(101)), sourceRef: "fake-remote:oversized" }],
    });
    const result = await lookup(repo, [source], { ...options, query: { barcode } });
    expect(result.results).toEqual([]);
    expect(result.sources).toEqual({ "fake-remote": "error" });
    expect(result.manual).toEqual({ barcode });
    expect(repo.writes).toEqual([]);
  });

  it("returns and caches a barcode candidate with unknown nutrition without losing healthy sources", async () => {
    const unknown = { ...candidate(), carbsPer100g: null, portions: [] };
    const source = new FakeFoodSource({ id: "fake-remote", kind: "remote", candidates: [unknown] });
    const repo = new MemoryFoodRepository();
    const local = plugins()[1];
    if (!local) throw new Error("Missing local fake");
    const result = await lookup(repo, [source, local], { ...options, query: { barcode } });
    expect(result.sources).toEqual({ "fake-remote": "ok", "fake-local": "ok" });
    expect(result.results[0]?.food).toMatchObject({ carbsPer100g: null, portions: [] });
    expect(repo.rows[0]).toMatchObject({ carbsPer100g: null, verified: false, spaceId: null });
    const cached = await lookup(repo, [], { ...options, query: { barcode } });
    expect(cached.results[0]).toMatchObject({ source: "cache", food: { carbsPer100g: null } });
  });

  it("normalises UPC-A before querying any layer and does not cache local or text results", async () => {
    const repo = new MemoryFoodRepository([row("barcode", { barcode: "0036000291452" })]);
    const local = new FakeFoodSource({
      id: "fake-local",
      kind: "local",
      candidates: [candidate("Example local", "fake-local")],
    });
    const result = await lookup(repo, [local], { ...options, query: { barcode: "036000291452" } });
    expect(result.results[0]?.source).toBe("library");
    expect(result.manual).toEqual({ barcode: "0036000291452" });
    await lookup(repo, plugins(), options);
    expect(repo.writes).toEqual([]);
  });

  it("propagates repository failures and rejects bad input before calling plugins", async () => {
    const repo = new MemoryFoodRepository();
    vi.spyOn(repo, "searchLibrary").mockRejectedValue(new Error("storage unavailable"));
    await expect(lookup(repo, plugins(), options)).rejects.toThrow("storage unavailable");
    await expect(
      lookup(repo, [], { ...options, query: { barcode: "2000000000000" } }),
    ).rejects.toThrow();
  });

  it("has no plugin names or space-data write access and keeps fakes off the public surface", () => {
    const code = readFileSync(new URL("./lookup.ts", import.meta.url), "utf8");
    expect(code).not.toMatch(/\b(off|frida)\b/i);
    const index = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
    expect(index).not.toMatch(/from ["'].*(?:food\/registry|photos\/|food\/fake|food\/memory)/);
    expect(code).not.toMatch(/\b(?:prisma|emit|createFood|updateFood|deleteFood)\b/);
  });
});

describe("submitted semantic search", () => {
  const vector = [1, ...Array<number>(1023).fill(0)];
  it("merges within library/cache tiers, retaining keyword order and distance threshold", async () => {
    const repo = new MemoryFoodRepository([
      row("keyword"),
      row("pasta", { name: "Pasta med kødsovs", nameSearch: "pasta med kodsovs" }),
      row("cache", {
        spaceId: null,
        sourceRef: "remote-test:cache",
        name: "Noodles",
        nameSearch: "noodles",
      }),
      row("far", { name: "Far", nameSearch: "far" }),
    ]);
    await repo.setEmbeddings([
      { id: "keyword", vector, model: "test:model" },
      { id: "pasta", vector, model: "test:model" },
      { id: "cache", vector, model: "test:model" },
      { id: "far", vector: vector.map((n) => -n), model: "test:model" },
    ]);
    const embed = vi.fn().mockResolvedValue({ vector, model: "test:model" });
    const found = await lookup(repo, [], {
      ...options,
      embed,
      query: { q: "example", remote: true },
    });
    expect(found.results.map((r) => r.food.name)).toEqual([
      "Example loaf",
      "Pasta med kødsovs",
      "Noodles",
    ]);
    expect(embed).toHaveBeenCalledExactlyOnceWith("example");
    expect(found.sources.semantic).toBe("ok");
  });
  it("a child's misspelling searches only verified own foods, never cache", async () => {
    const repo = new MemoryFoodRepository([
      row("pasta", { name: "Pasta med kødsovs", nameSearch: "pasta med kodsovs", verified: true }),
      row("unchecked"),
      row("cache", { spaceId: null }),
      row("other", { spaceId: "s2", verified: true }),
    ]);
    await repo.setEmbeddings(repo.rows.map(({ id }) => ({ id, vector, model: "test:model" })));
    const result = await lookup(repo, [], {
      ...options,
      session: { simpleMode: true },
      query: { q: "spagetti", remote: true },
      embed: () => Promise.resolve({ vector, model: "test:model" }),
    });
    expect(result.results.map((r) => r.food.name)).toEqual(["Pasta med kødsovs"]);
  });
  it("typing, short queries, unavailable embeddings and barcodes retain keyword lookup", async () => {
    const repo = new MemoryFoodRepository([row("a")]);
    const semantic = vi.spyOn(repo, "searchLibrarySemantic");
    const embed = vi.fn().mockResolvedValue(null);
    for (const query of [{ q: "example", remote: false }, { q: "ex", remote: true }, { barcode }])
      await lookup(repo, [], { ...options, query, embed });
    expect(embed).not.toHaveBeenCalled();
    const result = await lookup(repo, [], { ...options, embed });
    expect(result.results).toHaveLength(1);
    expect(result.sources.semantic).toBe("skipped");
    expect(semantic).not.toHaveBeenCalled();
  });
});

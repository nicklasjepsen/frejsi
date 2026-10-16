import { EventEnvelope } from "../schemas/events";
import { expect, it } from "vitest";
import { Food } from "../schemas/food";
import type { EmitFn } from "../events/emit";
import { MemoryFoodRepository } from "./memory";
const food = (id: string, overrides = {}) =>
  Food.parse({
    id,
    spaceId: "s1",
    name: "Example loaf",
    nameSearch: "example loaf",
    origin: "remote-test",
    sourceRef: "remote-test:loaf",
    carbsPer100g: 40,
    portions: [],
    createdAt: "2026-10-15T12:00:00Z",
    updatedAt: "2026-10-15T12:00:00Z",
    ...overrides,
  });
const emit: EmitFn = (spaceId, type, payload) =>
  Promise.resolve(
    EventEnvelope.parse({ spaceId, type, payload, seq: 1, ts: "2026-10-15T12:00:00Z" }),
  );
it("limits candidate batches, selects cache before enabled spaces, and excludes typed/AI origins", async () => {
  const repo = new MemoryFoodRepository([
    food("a-verified", { verified: true }),
    food("space"),
    food("cache", { spaceId: null }),
    food("disabled", { spaceId: "off" }),
    food("typed", { origin: "manual" }),
    food("ai", { origin: "ai" }),
    food("done", { sourceName: "original" }),
  ]);
  expect(
    (await repo.normalisationCandidates(["remote-test", "manual", "ai"], ["s1"], 1)).map(
      (r) => r.id,
    ),
  ).toEqual(["cache"]);
  expect(
    (await repo.normalisationCandidates(["remote-test", "manual", "ai"], ["s1"], 50)).map(
      (r) => r.id,
    ),
  ).toEqual(["cache", "space"]);
});
it("does not overwrite a concurrent rename or attach a stale vector; filters incompatible models and zero vectors", async () => {
  const repo = new MemoryFoodRepository([food("a"), food("other", { spaceId: "s2" })]);
  const current = repo.rows[0];
  if (!current) throw new Error("Missing fixture");
  const original = structuredClone(current);
  current.name = "My own loaf";
  await repo.setNormalisedName(original, { name: "Clean loaf", portions: [] }, ["s1"], emit);
  await repo.setEmbeddings([{ id: "a", name: original.name, model: "test:first", vector: [1, 0] }]);
  expect(repo.rows[0]?.name).toBe("My own loaf");
  expect(repo.embeddings.has("a")).toBe(false);
  await repo.setEmbeddings([
    { id: "a", model: "test:first", vector: [1, 0] },
    { id: "other", model: "test:second", vector: [1, 0] },
  ]);
  expect(await repo.searchLibrarySemantic("s1", [1, 0], "test:second", 20)).toEqual([]);
  expect(await repo.searchLibrarySemantic("s1", [0, 0], "test:first", 20)).toEqual([]);
  expect((await repo.embeddingCandidates("s1", "test:second", 100)).map((r) => r.id)).toEqual([
    "a",
  ]);
});

it("keeps an already verified name and portions unchanged", async () => {
  const repo = new MemoryFoodRepository([food("verified", { verified: true, verifiedBy: "u1" })]);
  const row = repo.rows[0];
  if (!row) throw new Error("Missing fixture");
  await repo.setNormalisedName(
    structuredClone(row),
    { name: "Clean loaf", portions: [{ label: "slice", grams: 45, carbs: 18 }] },
    ["s1"],
    emit,
  );
  expect(repo.rows[0]).toMatchObject({
    name: "Example loaf",
    portions: [],
    verified: true,
    verifiedBy: "u1",
  });
});

// @vitest-environment node
import { createLogger, type SessionContext } from "@frejsi/shared";
import { type MemoryPhotoStore } from "@frejsi/shared/photos/memory";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFood,
  listFoods,
  getFood,
  addCandidate,
  verifyFoods,
  updateFood,
  deleteFood,
  setFoodPhoto,
} from "./index";
import { foodTestRig, actor, candidate, T0 } from "./test-fixture.test";

let rig: ReturnType<typeof foodTestRig>;
beforeEach(() => {
  rig = foodTestRig();
});
afterEach(() => {
  rig.reset();
  vi.useRealTimers();
});
const fields = {
  name: "Cloud pear",
  carbsPer100g: 12.5,
  portions: [{ label: "slice", grams: 40, carbs: 5 }],
};
const create = (from: "library" | "log" = "library", verify = false, session = actor) =>
  createFood("s1", session, { ...fields, from, verify }, rig.deps);

describe("food writes", () => {
  it.each([
    ["library", "family"],
    ["log", "manual"],
  ] as const)(
    "creates %s food unverified with its own sourceRef and one event",
    async (from, origin) => {
      const food = await create(from);
      expect(food).toMatchObject({
        ...fields,
        origin,
        verified: false,
        createdAt: T0.toISOString(),
        createdBy: { id: actor.userId, name: actor.name },
      });
      expect(rig.rows[0]).toMatchObject({
        spaceId: "s1",
        sourceRef: `${origin}:${food.id}`,
        nameSearch: "cloud pear",
        createdBy: actor.userId,
      });
      expect(rig.events.map((e) => e.type)).toEqual(["food.created"]);
      expect(rig.published).toHaveLength(1);
    },
  );
  it("creates then verifies with two ordered events and human attribution", async () => {
    const food = await create("library", true);
    expect(food).toMatchObject({ verified: true, verifiedBy: actor.userId });
    expect(rig.rows[0]?.verifiedAt).toEqual(T0);
    expect(rig.events.map((e) => e.type)).toEqual(["food.created", "food.verified"]);
    expect(rig.events.map((e) => e.seq)).toEqual([1, 2]);
  });
  it("rolls back the food when event storage fails and publishes nothing", async () => {
    rig.failEvent = true;
    await expect(create()).rejects.toThrow();
    expect(rig.rows).toEqual([]);
    expect(rig.events).toEqual([]);
    expect(rig.published).toEqual([]);
  });
  it.each(["remote", "local"] as const)(
    "copies a %s candidate unverified and deduplicates repeated picks",
    async (kind) => {
      rig.sourceKind = kind;
      const first = await addCandidate("s1", actor, candidate, rig.deps);
      const again = await addCandidate("s1", actor, candidate, rig.deps);
      expect(first).toMatchObject({ origin: candidate.origin, verified: false });
      expect(again.id).toBe(first.id);
      expect(rig.events.map((e) => e.type)).toEqual(["food.created"]);
      const cache = rig.rows.filter((row) => row.spaceId === null);
      expect(cache).toHaveLength(kind === "remote" ? 1 : 0);
      if (cache[0])
        expect(cache[0]).toMatchObject({ verified: false, sourceRef: candidate.sourceRef });
    },
  );
  it("uses authoritative adapter data instead of trusting a new remote candidate's client fields", async () => {
    const food = await addCandidate(
      "s1",
      actor,
      { ...candidate, name: "Forged pear", carbsPer100g: 99 },
      rig.deps,
    );
    expect(food).toMatchObject({
      name: candidate.name,
      carbsPer100g: candidate.carbsPer100g,
      verified: false,
    });
    expect(rig.rows.find((row) => row.spaceId === null)).toMatchObject({
      name: candidate.name,
      carbsPer100g: candidate.carbsPer100g,
    });
    expect(rig.events).toHaveLength(1);
  });
  it("copies an existing canonical cache entry without letting stale or crafted fields overwrite it", async () => {
    rig.seed({
      spaceId: null,
      origin: candidate.origin,
      sourceRef: candidate.sourceRef,
      name: "Canonical pear",
      sourceName: "ORIGINAL CANONICAL PEAR",
      nameSearch: "canonical pear",
      carbsPer100g: 17,
    });
    rig.sourceStatus = "error";
    const food = await addCandidate(
      "s1",
      actor,
      { ...candidate, name: "Forged pear", carbsPer100g: 99 },
      rig.deps,
    );
    expect(food).toMatchObject({
      name: "Canonical pear",
      carbsPer100g: 17,
      verified: false,
      sourceName: "ORIGINAL CANONICAL PEAR",
      createdAt: T0.toISOString(),
      createdBy: { id: actor.userId, name: actor.name },
    });
    expect(rig.rows.find((row) => row.spaceId === null)).toMatchObject({
      name: "Canonical pear",
      carbsPer100g: 17,
    });
    expect(rig.events).toHaveLength(1);
  });
  it("does not cache a remote candidate whose identity the adapter cannot confirm", async () => {
    rig.remoteCandidates = [];
    await expect(addCandidate("s1", actor, candidate, rig.deps)).rejects.toMatchObject({
      status: 400,
      code: "validation",
    });
    rig.sourceStatus = "error";
    await expect(addCandidate("s1", actor, candidate, rig.deps)).rejects.toMatchObject({
      status: 503,
      code: "lookup-unavailable",
    });
    expect(rig.rows).toEqual([]);
    expect(rig.events).toEqual([]);
  });
  it("saves a legitimate non-barcode remote pick without assuming its display name reproduces its search", async () => {
    const offered = {
      name: "Cloud fruit",
      carbsPer100g: 17,
      portions: [],
      origin: "remote-test",
      sourceRef: "remote-test:fruit",
    };
    rig.remoteCandidates = [offered];
    rig.deps.sources = [
      {
        id: "remote-test",
        kind: "remote",
        search: (q) => Promise.resolve({ status: "ok", candidates: q === "pear" ? [offered] : [] }),
        byBarcode: () => Promise.resolve({ status: "ok", candidates: [] }),
      },
    ];
    const food = await addCandidate("s1", actor, offered, rig.deps);
    expect(food).toMatchObject({
      name: "Cloud fruit",
      carbsPer100g: 17,
      verified: false,
      origin: "remote-test",
    });
    expect(rig.rows).toHaveLength(1);
    expect(rig.rows[0]).toMatchObject({
      spaceId: "s1",
      sourceRef: offered.sourceRef,
      verified: false,
    });
    expect(rig.events.map((event) => event.type)).toEqual(["food.created"]);
    expect((await addCandidate("s1", actor, offered, rig.deps)).id).toBe(food.id);
    expect(rig.events).toHaveLength(1);
  });
  it("bounds candidate validation even when a source ignores cancellation", async () => {
    vi.useFakeTimers();
    rig.sourcePending = true;
    const result = expect(addCandidate("s1", actor, candidate, rig.deps)).rejects.toMatchObject({
      status: 503,
      code: "lookup-unavailable",
    });
    await vi.advanceTimersByTimeAsync(2500);
    await result;
    expect(rig.rows).toEqual([]);
    expect(rig.events).toEqual([]);
  });
  it("can pick an existing cached candidate after its remote source is disabled", async () => {
    const first = await addCandidate("s1", actor, candidate, rig.deps);
    rig.deps.sources = [];
    expect((await addCandidate("s1", actor, candidate, rig.deps)).id).toBe(first.id);
    const otherSpace = { ...actor, memberships: [{ spaceId: "s2", role: "carer" as const }] };
    const second = await addCandidate("s2", otherSpace, candidate, rig.deps);
    expect(second).toMatchObject({ origin: candidate.origin, verified: false });
    expect(second.id).not.toBe(first.id);
    expect(rig.events.map((event) => event.type)).toEqual(["food.created", "food.created"]);
  });
  it("refuses an unregistered candidate or a sourceRef belonging to another source", async () => {
    await expect(
      addCandidate("s1", actor, { ...candidate, origin: "unregistered" }, rig.deps),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      addCandidate("s1", actor, { ...candidate, sourceRef: "elsewhere:item" }, rig.deps),
    ).rejects.toMatchObject({ status: 400 });
    expect(rig.rows).toEqual([]);
    expect(rig.events).toEqual([]);
  });
  it("verifies only space copies and rejects a mixed batch before changing anything", async () => {
    const food = await create();
    rig.seed({ id: "cache", spaceId: null });
    rig.seed({ id: "foreign", spaceId: "s2" });
    for (const id of ["cache", "foreign", "missing"]) {
      await expect(verifyFoods("s1", actor, [food.id, id], rig.deps)).rejects.toMatchObject({
        status: 404,
      });
    }
    expect(rig.rows.find((r) => r.id === food.id)?.verified).toBe(false);
    expect(rig.events).toHaveLength(1);
    await verifyFoods("s1", actor, [food.id], rig.deps);
    expect(rig.rows.find((r) => r.id === food.id)).toMatchObject({
      verified: true,
      verifiedBy: actor.userId,
      verifiedAt: T0,
    });
    expect(rig.events.map((e) => e.type)).toEqual(["food.created", "food.verified"]);
  });
  it("rewrites the folded name and recomputes weighed portions while keeping portion-only carbs", async () => {
    const food = await create();
    const updated = await updateFood(
      "s1",
      actor,
      food.id,
      {
        name: "Sølv cloud",
        carbsPer100g: 20,
        portions: [
          { label: "slice", grams: 40, carbs: 999 },
          { label: "box", carbs: 42 },
        ],
      },
      rig.deps,
    );
    expect(updated).toMatchObject({
      name: "Sølv cloud",
      portions: [
        { label: "slice", grams: 40, carbs: 8 },
        { label: "box", carbs: 42 },
      ],
    });
    expect(rig.rows[0]?.nameSearch).toBe("solv cloud");
    await updateFood("s1", actor, food.id, { carbsPer100g: 25 }, rig.deps);
    expect((JSON.parse(String(rig.rows[0]?.portions)) as { carbs: number }[])[0]?.carbs).toBe(10);
    expect(rig.events.map((e) => e.type)).toEqual(["food.created", "food.updated", "food.updated"]);
    await expect(
      updateFood("s1", actor, food.id, { carbsPer100g: null, portions: [] }, rig.deps),
    ).rejects.toMatchObject({ status: 400 });
    expect(rig.events).toHaveLength(3);
  });
  it("invalidates verification after content edits, keeps favourite-only edits checked, and requires a new human tick", async () => {
    const food = await create("library", true);
    await updateFood("s1", actor, food.id, { favourite: true }, rig.deps);
    expect(rig.rows[0]?.verified).toBe(true);
    await updateFood("s1", { ...actor, simpleMode: true }, food.id, { carbsPer100g: 25 }, rig.deps);
    expect(rig.rows[0]).toMatchObject({ verified: false, verifiedBy: null, verifiedAt: null });
    expect((await listFoods("s1", { ...actor, simpleMode: true }, {}, rig.deps)).foods).toEqual([]);
    await verifyFoods("s1", actor, [food.id], rig.deps);
    expect(rig.rows[0]).toMatchObject({ verified: true, verifiedBy: actor.userId });
    await updateFood("s1", actor, food.id, { name: "New cloud pear" }, rig.deps);
    expect(rig.rows[0]).toMatchObject({ verified: false, verifiedBy: null, verifiedAt: null });
    expect(rig.events.map((event) => event.type)).toEqual([
      "food.created",
      "food.verified",
      "food.updated",
      "food.updated",
      "food.verified",
      "food.updated",
    ]);
  });
  it("deletes the food, nulls meal links and preserves the snapshot", async () => {
    const food = await create();
    rig.items.push({
      foodId: food.id,
      name: "Earlier cloud pear",
      carbs: 17,
      meal: { spaceId: "s1", ts: T0 },
    });
    await deleteFood("s1", actor, food.id, rig.deps);
    expect(rig.rows).toEqual([]);
    expect(rig.items[0]).toMatchObject({ foodId: null, name: "Earlier cloud pear", carbs: 17 });
    expect(rig.events.map((e) => e.type)).toEqual(["food.created", "food.deleted"]);
  });
});

describe("food reads", () => {
  it("filters by folded words, ownership, origin, favourite and verification and counts visible foods", async () => {
    rig.seed({
      id: "a",
      name: "Sølv cloud",
      nameSearch: "solv cloud",
      verified: true,
      favourite: true,
    });
    rig.seed({ id: "b", name: "Pear", nameSearch: "pear", origin: "remote-test" });
    rig.seed({ id: "c", origin: "manual", verified: true });
    rig.seed({ id: "foreign", spaceId: "s2" });
    rig.seed({ id: "cache", spaceId: null });
    const all = await listFoods("s1", actor, {}, rig.deps);
    expect(all.foods).toHaveLength(3);
    expect(all.counts).toMatchObject({
      all: 3,
      unverified: 1,
      own: 2,
      favourites: 1,
      "remote-test": 1,
    });
    for (const [filter, ids] of [
      ["unverified", ["b"]],
      ["own", ["a", "c"]],
      ["favourites", ["a"]],
      ["remote-test", ["b"]],
    ] as const) {
      expect(
        (await listFoods("s1", actor, { filter }, rig.deps)).foods.map((f) => f.id).sort(),
      ).toEqual([...ids].sort());
    }
    expect(
      (await listFoods("s1", actor, { q: "cloud sølv" }, rig.deps)).foods.map((f) => f.id),
    ).toEqual(["a"]);
    const simple = await listFoods(
      "s1",
      { ...actor, simpleMode: true },
      { filter: "unverified" },
      rig.deps,
    );
    expect(simple.foods).toEqual([]);
    expect(simple.counts).toMatchObject({ all: 2, unverified: 0 });
    await expect(
      getFood("s1", { ...actor, simpleMode: true }, "b", rig.deps),
    ).rejects.toMatchObject({ status: 404 });
  });
  it("keeps whole-library counts when a search has no matches so the screen can distinguish an empty library", async () => {
    rig.seed({ id: "a", verified: true });
    rig.seed({ id: "b", origin: "remote-test" });
    const result = await listFoods("s1", actor, { q: "no such fictional food" }, rig.deps);
    expect(result.foods).toEqual([]);
    expect(result.counts).toMatchObject({ all: 2, unverified: 1 });
    const simple = await listFoods(
      "s1",
      { ...actor, simpleMode: true },
      { q: "no match" },
      rig.deps,
    );
    expect(simple.counts).toMatchObject({ all: 1, unverified: 0 });
  });
  it("returns recent foods once each, newest first, within 30 days and this space", async () => {
    for (const id of ["a", "b", "c"]) rig.seed({ id });
    rig.items.push(
      ...[
        { foodId: "a", meal: { spaceId: "s1", ts: new Date(T0.getTime() - 86_400_000) } },
        { foodId: "a", meal: { spaceId: "s1", ts: new Date(T0.getTime() - 2 * 86_400_000) } },
        { foodId: "b", meal: { spaceId: "s1", ts: T0 } },
        { foodId: "c", meal: { spaceId: "s1", ts: new Date(T0.getTime() - 31 * 86_400_000) } },
        { foodId: "c", meal: { spaceId: "s2", ts: T0 } },
      ],
    );
    const result = await listFoods("s1", actor, { filter: "recent" }, rig.deps);
    expect(result.foods.map((f) => f.id)).toEqual(["b", "a"]);
    expect(result.counts.recent).toBe(2);
    expect(rig.events).toEqual([]);
  });
});

describe("photos", () => {
  const image = Buffer.from("UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=", "base64");
  it("processes, replaces, signs and deletes private photos through PhotoStore with one event per change", async () => {
    const food = await create();
    const updated = await setFoodPhoto("s1", actor, food.id, image, rig.deps);
    const key = String(rig.rows[0]?.photoKey);
    expect(key).toMatch(new RegExp(`^spaces/s1/foods/${food.id}/`));
    expect(updated.photo?.thumbUrl).toContain(`${key}/thumb.jpg`);
    const store = rig.deps.photos as MemoryPhotoStore;
    expect(Array.from(store.photos.get(key)?.original.slice(0, 2) ?? [])).toEqual([255, 216]);
    await setFoodPhoto("s1", actor, food.id, image, rig.deps);
    expect(store.photos.has(key)).toBe(false);
    expect(store.photos.size).toBe(1);
    await setFoodPhoto("s1", actor, food.id, null, rig.deps);
    expect(store.photos.size).toBe(0);
    expect(rig.rows[0]?.photoKey).toBeNull();
    expect(rig.events.map((e) => e.type)).toEqual([
      "food.created",
      "food.updated",
      "food.updated",
      "food.updated",
    ]);
  });
  it("keeps the previous photo and removes a new upload when event storage fails", async () => {
    const food = await create();
    await setFoodPhoto("s1", actor, food.id, image, rig.deps);
    const key = rig.rows[0]?.photoKey;
    rig.failEvent = true;
    await expect(setFoodPhoto("s1", actor, food.id, image, rig.deps)).rejects.toThrow();
    expect(rig.rows[0]?.photoKey).toBe(key);
    expect((rig.deps.photos as MemoryPhotoStore).photos.size).toBe(1);
    expect(rig.events.map((event) => event.type)).toEqual(["food.created", "food.updated"]);
    expect(rig.published).toHaveLength(2);
    const listed = await listFoods("s1", actor, {}, rig.deps);
    expect(listed.foods[0]?.photo?.thumbUrl).toContain(String(key));
  });
  it("reports a committed change as successful if obsolete blob cleanup fails and logs only a count", async () => {
    const lines: string[] = [];
    rig.deps.log = createLogger((line) => lines.push(line));
    const food = await create();
    await setFoodPhoto("s1", actor, food.id, image, rig.deps);
    const store = rig.deps.photos as MemoryPhotoStore;
    rig.deps.photos = {
      put: (key, bytes) => store.put(key, bytes),
      readUrl: (key, size) => store.readUrl(key, size),
      delete: () => Promise.reject(new Error("unavailable")),
    };
    const updated = await setFoodPhoto("s1", actor, food.id, image, rig.deps);
    expect(updated.photo?.thumbUrl).toContain(String(rig.rows[0]?.photoKey));
    await deleteFood("s1", actor, food.id, rig.deps);
    expect(rig.rows).toEqual([]);
    expect(rig.events.map((event) => event.type)).toEqual([
      "food.created",
      "food.updated",
      "food.updated",
      "food.deleted",
    ]);
    expect(rig.published).toHaveLength(4);
    expect(lines).toHaveLength(2);
    for (const line of lines)
      expect(JSON.parse(line)).toMatchObject({ code: "photo-unavailable", count: 1 });
    expect(lines.join("\n")).not.toMatch(/spaces\/|Cloud pear|thumbUrl|unavailable.*unavailable/);
  });
  it("removes a food's blobs on food delete", async () => {
    const food = await create();
    await setFoodPhoto("s1", actor, food.id, image, rig.deps);
    await deleteFood("s1", actor, food.id, rig.deps);
    expect((rig.deps.photos as MemoryPhotoStore).photos.size).toBe(0);
    expect(rig.events).toHaveLength(3);
  });
  it("returns safe photo errors and leaves food and events unchanged", async () => {
    const food = await create();
    for (const [bytes, code] of [
      [new Uint8Array([1, 2]), "photo-type"],
      [new Uint8Array(8 * 1024 * 1024 + 1), "photo-too-large"],
    ] as const) {
      await expect(setFoodPhoto("s1", actor, food.id, bytes, rig.deps)).rejects.toMatchObject({
        status: 400,
        code,
      });
    }
    for (const bytes of [image, null])
      await expect(
        setFoodPhoto("s1", actor, food.id, bytes, { ...rig.deps, photos: null }),
      ).rejects.toMatchObject({ status: 503, code: "photo-unavailable" });
    expect(rig.rows[0]?.photoKey).toBeNull();
    expect(rig.events).toHaveLength(1);
  });
});

it("gates services for viewers and simpleMode verification before any writes", async () => {
  const viewer: SessionContext = { ...actor, memberships: [{ spaceId: "s1", role: "viewer" }] };
  await expect(create("library", false, viewer)).rejects.toMatchObject({ status: 403 });
  await expect(listFoods("s1", viewer, {}, rig.deps)).rejects.toMatchObject({ status: 403 });
  await expect(create("library", true, { ...actor, simpleMode: true })).rejects.toMatchObject({
    status: 400,
    code: "simple-mode",
  });
  await expect(
    verifyFoods("s1", { ...actor, simpleMode: true }, ["a"], rig.deps),
  ).rejects.toMatchObject({ status: 400, code: "simple-mode" });
  expect(rig.rows).toEqual([]);
  expect(rig.events).toEqual([]);
});

it("logs only ids, counts and codes even when publish fails", async () => {
  const lines: string[] = [];
  rig.deps.log = createLogger((line) => lines.push(line));
  rig.failPublish = true;
  await create();
  expect(lines.length).toBeGreaterThan(0);
  expect(lines.join("\n")).not.toMatch(/Cloud pear|2000000000015|nameSearch|portions|photos/);
});

it("returns original provenance on reads and edits, including a different creator", async () => {
  rig.users.push({ id: "u2", name: "Example maker" });
  const createdAt = new Date("2026-10-13T09:00:00Z");
  rig.seed({ id: "original", createdBy: "u2", createdAt, sourceName: "ORIGINAL PEAR" });
  const provenance = {
    createdAt: createdAt.toISOString(),
    sourceName: "ORIGINAL PEAR",
    createdBy: { id: "u2", name: "Example maker" },
  };
  expect(await getFood("s1", actor, "original", rig.deps)).toMatchObject(provenance);
  expect((await listFoods("s1", actor, {}, rig.deps)).foods[0]).toMatchObject(provenance);
  expect(
    await updateFood("s1", actor, "original", { name: "Edited pear" }, rig.deps),
  ).toMatchObject(provenance);
  rig.seed({ id: "legacy", createdBy: null });
  const legacy = await getFood("s1", actor, "legacy", rig.deps);
  expect(legacy.createdAt).toBe(T0.toISOString());
  expect(legacy.createdBy).toBeUndefined();
});

it("batches creator provenance for a 100-food library and verification responses", async () => {
  rig.users.push({ id: "u2", name: "Example maker" });
  for (let i = 0; i < 100; i++)
    rig.seed({ id: `batch-${i}`, createdBy: i % 2 ? "u2" : actor.userId });
  const db = rig.deps.db;
  if (!db) throw new Error("Missing database double");
  const single = vi.spyOn(db.user, "findUnique");
  const batch = vi.spyOn(db.user, "findMany");
  const { foods } = await listFoods("s1", actor, {}, rig.deps);
  expect(foods).toHaveLength(100);
  for (const food of foods) {
    const i = Number(food.id.split("-")[1]);
    expect(food.createdBy).toEqual(
      i % 2 ? { id: "u2", name: "Example maker" } : { id: actor.userId, name: actor.name },
    );
  }
  expect(single).not.toHaveBeenCalled();
  expect(batch).toHaveBeenCalledTimes(1);
  expect(await verifyFoods("s1", actor, ["batch-0", "batch-1"], rig.deps)).toMatchObject([
    { verified: true, createdBy: { id: actor.userId, name: actor.name } },
    { verified: true, createdBy: { id: "u2", name: "Example maker" } },
  ]);
  expect(single).not.toHaveBeenCalled();
  expect(batch).toHaveBeenCalledTimes(2);
});

it("renaming clears the vector and model, preserving search after a human edit", async () => {
  const rig = foodTestRig();
  const food = rig.seed({ id: "rename", embedding: [1], embeddingModel: "test:model" });
  await updateFood("s1", actor, String(food.id), { name: "New pear" }, rig.deps);
  expect(rig.rows.find((row) => row.id === "rename")).toMatchObject({
    name: "New pear",
    embedding: null,
    embeddingModel: null,
  });
  expect(rig.events.at(-1)?.type).toBe("food.updated");
});

it("addCandidate keeps its key-free signature and never obtains or calls AI", async () => {
  const { FakeAiProvider } = await import("@frejsi/shared/ai/fake");
  const { CappedAiProvider } = await import("@frejsi/shared/ai");
  const { MemoryAiCallRepository } = await import("@frejsi/shared/ai/calls");
  const { searchEmbed } = await import("@frejsi/shared/ai/search/embed");
  const rig = foodTestRig();
  const fake = new FakeAiProvider();
  const provider = new CappedAiProvider(fake, new MemoryAiCallRepository(), {
    spaceId: "s1",
    timezone: "UTC",
  });
  rig.deps.searchEmbedding = () => Promise.resolve(searchEmbed(provider, ""));
  const food = await addCandidate("s1", actor, candidate, rig.deps);
  expect(food).toMatchObject({ name: candidate.name, verified: false });
  expect(rig.events.map((event) => event.type)).toEqual(["food.created"]);
  expect(fake.calls).toEqual([]);
});

it("keeps a human rename's source provenance while the source plugin is disabled", async () => {
  const rig = foodTestRig();
  rig.seed({
    id: "disabled-source",
    origin: "remote-test",
    sourceRef: "remote-test:pear",
    name: "RAW PEAR",
    sourceName: null,
  });
  rig.deps.sources = [];
  await updateFood("s1", actor, "disabled-source", { name: "My pear" }, rig.deps);
  expect(rig.rows.find((row) => row.id === "disabled-source")).toMatchObject({
    name: "My pear",
    sourceName: "RAW PEAR",
    verified: false,
  });
});

it("keeps keyword hits before semantic hits in the recent-food filter", async () => {
  const { Food } = await import("@frejsi/shared/schemas/food");
  const { MemoryFoodRepository } = await import("@frejsi/shared/food/memory");
  const { FakeAiProvider } = await import("@frejsi/shared/ai/fake");
  const { CappedAiProvider } = await import("@frejsi/shared/ai");
  const { MemoryAiCallRepository } = await import("@frejsi/shared/ai/calls");
  const { searchEmbed } = await import("@frejsi/shared/ai/search/embed");
  const vector = [1, ...Array<number>(1023).fill(0)];
  const foods = [
    { id: "keyword", name: "Cloud pear", nameSearch: "cloud pear" },
    { id: "near", name: "Cloud fruit", nameSearch: "cloud fruit" },
  ].map((food) =>
    Food.parse({
      ...food,
      spaceId: "s1",
      origin: "family",
      sourceRef: `family:${food.id}`,
      carbsPer100g: 10,
      portions: [],
      createdAt: T0.toISOString(),
      updatedAt: T0.toISOString(),
    }),
  );
  for (const food of foods) rig.seed({ id: food.id, name: food.name, nameSearch: food.nameSearch });
  rig.items.push(
    { foodId: "keyword", meal: { spaceId: "s1", ts: new Date(T0.getTime() - 60_000) } },
    { foodId: "near", meal: { spaceId: "s1", ts: T0 } },
  );
  const repo = new MemoryFoodRepository(foods);
  await repo.setEmbeddings(foods.map(({ id }) => ({ id, vector, model: "fixture" })));
  const provider = new CappedAiProvider(
    new FakeAiProvider([{ vectors: [vector], model: "fixture" }]),
    new MemoryAiCallRepository(),
    { spaceId: "s1", timezone: "UTC" },
  );
  const result = await listFoods(
    "s1",
    actor,
    { q: "pear", filter: "recent", mode: "semantic" },
    { ...rig.deps, repo, searchEmbedding: () => Promise.resolve(searchEmbed(provider, "")) },
  );
  expect(result.foods.map((food) => food.id)).toEqual(["keyword", "near"]);
});

describe("food categories and recipes (v0.6.0 task 1)", () => {
  const recipe = {
    ingredients: [{ name: "Fictional flour", amount: 500, unit: "g", grams: 500, carbs: 360 }],
    yieldPortions: 4,
    source: { kind: "text" as const, text: "500 g flour" },
  };
  it("creates a food with a category and reads it back; a row without one stays null-safe", async () => {
    const food = await createFood(
      "s1",
      actor,
      { ...fields, category: "fruit", from: "library" },
      rig.deps,
    );
    expect(food.category).toBe("fruit");
    expect(rig.rows[0]).toMatchObject({ category: "fruit", recipe: null });
    expect((await getFood("s1", actor, food.id, rig.deps)).category).toBe("fruit");
    const plain = await create();
    expect(plain.category).toBeUndefined();
    expect(plain.recipe).toBeUndefined();
    rig.seed({ id: "legacy", category: undefined, recipe: undefined });
    const legacy = await getFood("s1", actor, "legacy", rig.deps);
    expect(legacy.category).toBeUndefined();
    expect(legacy.recipe).toBeUndefined();
  });
  it("creates a dish from a recipe with origin recipe, counted among own foods", async () => {
    const dish = await createFood(
      "s1",
      actor,
      { ...fields, origin: "recipe", category: "bread", recipe, from: "library" },
      rig.deps,
    );
    expect(dish).toMatchObject({ origin: "recipe", category: "bread", recipe, verified: false });
    expect(rig.rows[0]).toMatchObject({
      origin: "recipe",
      sourceRef: `recipe:${dish.id}`,
      recipe: JSON.stringify(recipe),
    });
    expect(rig.events.map((e) => e.payload)).toEqual([{ foodId: dish.id, origin: "recipe" }]);
    const list = await listFoods("s1", actor, { filter: "own" }, rig.deps);
    expect(list.foods.map((f) => f.id)).toEqual([dish.id]);
    expect(list.counts).toMatchObject({ own: 1, recipe: 1 });
    // The log's manual path never makes a recipe.
    await expect(
      createFood("s1", actor, { ...fields, origin: "recipe", from: "log" }, rig.deps),
    ).rejects.toMatchObject({ status: 400 });
  });
  it("updates and clears the category and replaces the recipe without touching verification", async () => {
    const food = await create("library", true);
    const categorised = await updateFood("s1", actor, food.id, { category: "sweets" }, rig.deps);
    expect(categorised).toMatchObject({ category: "sweets", verified: true });
    expect(rig.rows[0]).toMatchObject({ category: "sweets", verified: true });
    const renamed = await updateFood("s1", actor, food.id, { name: "Cloud plum" }, rig.deps);
    expect(renamed).toMatchObject({ category: "sweets", verified: false });
    expect((await updateFood("s1", actor, food.id, { category: null }, rig.deps)).category).toBe(
      undefined,
    );
    expect(rig.rows[0]?.category).toBeNull();
    const withRecipe = await updateFood("s1", actor, food.id, { recipe }, rig.deps);
    expect(withRecipe.recipe).toEqual(recipe);
    expect(rig.rows[0]?.recipe).toBe(JSON.stringify(recipe));
    expect(
      (await updateFood("s1", actor, food.id, { favourite: true }, rig.deps)).recipe,
    ).toEqual(recipe);
    await expect(
      updateFood("s1", actor, food.id, { category: "loaf" }, rig.deps),
    ).rejects.toMatchObject({ status: 400 });
    expect(rig.events.map((e) => e.type)).toEqual([
      "food.created",
      "food.verified",
      "food.updated",
      "food.updated",
      "food.updated",
      "food.updated",
      "food.updated",
    ]);
  });
  it.each(["remote", "local"] as const)(
    "keeps a %s candidate's category on the space copy and, for a barcode pick, in the cache",
    async (kind) => {
      rig.sourceKind = kind;
      rig.remoteCandidates = [{ ...candidate, category: "dairy" }];
      const food = await addCandidate("s1", actor, { ...candidate, category: "dairy" }, rig.deps);
      expect(food.category).toBe("dairy");
      expect(rig.rows.find((row) => row.spaceId === "s1")).toMatchObject({ category: "dairy" });
      const cache = rig.rows.find((row) => row.spaceId === null);
      if (kind === "remote") expect(cache).toMatchObject({ category: "dairy" });
      else expect(cache).toBeUndefined();
    },
  );
  it("copies the cached category rather than the client's when the cache already has the food", async () => {
    rig.seed({
      spaceId: null,
      origin: candidate.origin,
      sourceRef: candidate.sourceRef,
      category: "snack",
    });
    const food = await addCandidate("s1", actor, { ...candidate, category: "sweets" }, rig.deps);
    expect(food.category).toBe("snack");
  });
});

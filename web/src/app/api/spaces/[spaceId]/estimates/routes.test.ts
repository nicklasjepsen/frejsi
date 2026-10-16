// @vitest-environment node
import plate from "./fixtures/plate.json";
import { createLogger } from "@frejsi/shared";
import { FakeAiProvider, defaultFakeAnswer } from "@frejsi/shared/ai/fake";
import { CappedAiProvider } from "@frejsi/shared/ai/capped";
import { MemoryAiCallRepository } from "@frejsi/shared/ai/calls";
import { type MemoryPhotoStore } from "@frejsi/shared/photos/memory";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FakeAuthDb } from "@/lib/auth/test-support";
import {
  seedSpace,
  request,
  params,
  USERS,
  T0,
  type Who,
} from "@/components/settings/route-test-support";
import { foodTestRig } from "@/lib/foods/test-fixture.test";
import { configureFoods } from "@/lib/foods/core";
import { configureEstimates } from "@/ai/estimate/service";
import { GET, POST } from "./route";
import { POST as ask } from "./ask/route";

let rig: ReturnType<typeof foodTestRig>;
let auth: FakeAuthDb;
let fake: FakeAiProvider;
let lines: string[];
let photoDataUrl: string;
let calls: MemoryAiCallRepository;
const estimate = {
  dishName: "Example plate",
  items: [{ name: "Pear", grams: 100, carbs: 12, confidence: "low", approx: true }],
  totalCarbs: 12,
  approx: true,
};
beforeEach(() => {
  rig = foodTestRig();
  auth = new FakeAuthDb(() => T0);
  seedSpace(auth);
  rig.deps.now = () => T0;
  for (const user of auth.rows("user")) user.locale = "en";
  fake = new FakeAiProvider(defaultFakeAnswer);
  calls = new MemoryAiCallRepository();
  lines = [];
  configureFoods({
    ...rig.deps,
    sessionDb: auth.db,
    log: createLogger((line) => lines.push(line)),
  });
  configureEstimates({
    provider: (spaceId, session) =>
      Promise.resolve(
        new CappedAiProvider(fake, calls, {
          spaceId,
          userId: session.userId,
          timezone: "UTC",
          dailyCap: 1,
          embedDailyCap: 1,
          now: () => T0,
        }),
      ),
  });
  photoDataUrl = plate.photoDataUrl;
});
afterEach(() => {
  vi.restoreAllMocks();
  rig.reset();
  configureEstimates({});
});
type Handler = typeof POST;
const call = (handler: Handler, body: unknown, as: Who | null = "carer", spaceId = "s1") =>
  handler(request("/api/spaces/s1/estimates", { method: "POST", body, as }), params({ spaceId }));
it.each(["owner", "carer"] as const)(
  "%s receives an approximate result without saving a photo or food",
  async (as) => {
    const res = await call(POST, { photoDataUrl }, as);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ approx: true, totalCarbs: 30 });
    expect(fake.calls).toHaveLength(1);
    expect(calls.rows).toHaveLength(1);
    expect(rig.rows).toEqual([]);
    expect(rig.items).toEqual([]);
    expect(rig.events).toEqual([]);
    expect((rig.deps.photos as MemoryPhotoStore).photos.size).toBe(0);
    expect(lines.join(" ")).not.toContain(photoDataUrl.split(",")[1]);
    const capped = await call(POST, { photoDataUrl }, as);
    expect(capped.status).toBe(429);
    expect(fake.calls).toHaveLength(1);
  },
);
it("allows simpleMode and saves only an unverified food, a photo and the three ordered events", async () => {
  Object.assign(auth.rows("user").find((u) => u.id === USERS.carer) ?? {}, { simpleMode: true });
  expect((await call(POST, { photoDataUrl })).status).toBe(200);
  const res = await call(ask, { photoDataUrl, estimate });
  expect(res.status).toBe(201);
  const { foodId } = (await res.json()) as { foodId: string };
  expect(rig.rows).toHaveLength(1);
  expect(rig.rows[0]).toMatchObject({
    id: foodId,
    origin: "ai",
    name: "Example plate",
    verified: false,
    createdBy: USERS.carer,
    carbsPer100g: 12,
  });
  expect(JSON.parse(String(rig.rows[0]?.portions))).toEqual([
    { label: "1 plate", grams: 100, carbs: 12 },
  ]);
  expect(rig.rows[0]?.sourceRef).toMatch(/^ai:/);
  expect((rig.deps.photos as MemoryPhotoStore).photos.size).toBe(1);
  expect(rig.events.map((e) => e.type)).toEqual(["food.created", "food.updated", "estimate.asked"]);
  expect(rig.events[2]?.payload).toEqual({ foodId, byUserId: USERS.carer });
  expect(rig.items).toEqual([]);
  expect(lines.join(" ")).not.toContain(photoDataUrl.split(",")[1]);
});
it("uses no per-100g value when an item's grams are unknown", async () => {
  const res = await call(ask, {
    photoDataUrl,
    estimate: {
      ...estimate,
      items: [{ name: "Pear", carbs: 12, confidence: "low", approx: true }],
    },
  });
  expect(res.status).toBe(201);
  expect(rig.rows[0]?.carbsPer100g).toBeNull();
  expect(JSON.parse(String(rig.rows[0]?.portions))).toEqual([{ label: "1 plate", carbs: 12 }]);
});
it.each([POST, ask, GET])(
  "rejects unauthorized callers before a provider call or write",
  async (handler) => {
    for (const [as, spaceId, status] of [
      ["viewer", "s1", 403],
      ["carer", "other", 404],
      [null, "s1", 403],
    ] as const) {
      expect((await call(handler, { photoDataUrl, estimate }, as, spaceId)).status).toBe(status);
    }
    expect(fake.calls).toEqual([]);
    expect(rig.events).toEqual([]);
  },
);
it.each([POST, ask])(
  "rejects PNG, invalid JPEG bytes and oversized input before a provider call",
  async (handler) => {
    for (const [photo, code] of [
      ["data:image/png;base64,YWJj", "photo-type"],
      ["data:image/jpeg;base64,YWJj", "photo-type"],
      [
        `data:image/jpeg;base64,${Buffer.alloc(8 * 1024 * 1024 + 1).toString("base64")}`,
        "photo-too-large",
      ],
    ]) {
      const res = await call(handler, {
        photoDataUrl: photo,
        ...(handler === ask ? { estimate } : {}),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code } });
    }
    expect(fake.calls).toEqual([]);
    expect(rig.rows).toEqual([]);
  },
);

it("publishes all three committed events in order and rolls back food and photo on a failed event", async () => {
  const res = await call(ask, { photoDataUrl, estimate });
  expect(res.status).toBe(201);
  expect(rig.published.map((event) => event.type)).toEqual([
    "food.created",
    "food.updated",
    "estimate.asked",
  ]);
  const before = rig.rows.length;
  rig.failEvent = true;
  expect((await call(ask, { photoDataUrl, estimate })).status).toBe(500);
  expect(rig.rows).toHaveLength(before);
  expect((rig.deps.photos as MemoryPhotoStore).photos.size).toBe(1);
  expect(rig.published).toHaveLength(3);
});
it("rejects unsafe client strings or inconsistent totals before saving", async () => {
  for (const bad of [
    { ...estimate, totalCarbs: 50 },
    { ...estimate, dishName: "take five" },
  ]) {
    expect((await call(ask, { photoDataUrl, estimate: bad })).status).toBeGreaterThanOrEqual(400);
  }
  expect(rig.rows).toEqual([]);
  expect(rig.events).toEqual([]);
});

it("removes the exact uploaded photo when the final event fails after storage", async () => {
  const db = rig.deps.db;
  if (!db) throw new Error("missing fake database");
  const store = rig.deps.photos as MemoryPhotoStore;
  const readUrl = store.readUrl.bind(store);
  // setFoodPhoto resolves the URLs after its own event; fail the subsequent estimate event.
  vi.spyOn(store, "readUrl").mockImplementation((key, size) => {
    rig.failEvent = true;
    return readUrl(key, size);
  });
  const res = await call(ask, { photoDataUrl, estimate });
  expect(res.status).toBe(500);
  expect(rig.rows).toEqual([]);
  expect(rig.events).toEqual([]);
  expect(rig.published).toEqual([]);
  expect((rig.deps.photos as MemoryPhotoStore).photos.size).toBe(0);
});

it("removes the uploaded photo if the outer transaction cannot commit", async () => {
  const db = rig.deps.db;
  if (!db) throw new Error("missing fake database");
  const transaction = db.$transaction.bind(db);
  db.$transaction = (run, options) =>
    transaction(async (tx) => {
      await run(tx);
      throw new Error("commit failed");
    }, options);
  expect((await call(ask, { photoDataUrl, estimate })).status).toBe(500);
  expect(rig.rows).toEqual([]);
  expect(rig.events).toEqual([]);
  expect(rig.published).toEqual([]);
  expect((rig.deps.photos as MemoryPhotoStore).photos.size).toBe(0);
});

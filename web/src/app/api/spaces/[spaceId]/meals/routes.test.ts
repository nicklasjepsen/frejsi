// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEnvelope, EventPayloads, type EmitFn } from "@frejsi/shared";
import { MemoryPhotoStore } from "@frejsi/shared/photos/memory";
import { FakeLiveDb, captureLog } from "@/lib/live/test-support";
import type { MealRecord, MealRepository } from "@/lib/meals/repository";
import { configureMeals } from "@/lib/meals/server";
import { POST } from "./route";
import { GET, PATCH, DELETE } from "./[mealId]/route";
import { PUT, DELETE as DELETE_PHOTO } from "./[mealId]/photo/route";
const at = new Date("2026-10-15T05:15:00.000Z");
const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";
const ctx = (mealId = "missing", spaceId = "s1") => ({
  params: Promise.resolve({ spaceId, mealId }),
});
const request = (method: string, user = "carer", body?: unknown) =>
  new Request("https://frejsi.example.invalid/api/spaces/s1/meals", {
    method,
    headers: { cookie: `frejsi_session=sess-${user}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
let rows: Map<string, MealRecord>;
let auth: FakeLiveDb;
let events: string[];
let logs: ReturnType<typeof captureLog>;
let repo: MealRepository;
let photos: MemoryPhotoStore;
beforeEach(() => {
  auth = new FakeLiveDb(() => new Date());
  auth.addSpace("s1");
  auth.addMember("carer", "s1", "carer");
  auth.addMember("viewer", "s1", "viewer");
  rows = new Map();
  events = [];
  logs = captureLog();
  repo = {
    food: () => Promise.resolve(null),
    find: (spaceId, id) =>
      Promise.resolve(rows.get(id)?.spaceId === spaceId ? (rows.get(id) ?? null) : null),
    lock: async (spaceId, id) => {
      const row = await repo.find(spaceId, id);
      if (!row) throw Object.assign(new Error("not-found"), { code: "not-found" });
      return row;
    },
    create: (data) => {
      const row = {
        ...data,
        byUser: { id: data.byUserId, name: "Fictional carer" },
        timezone: "America/New_York",
      };
      rows.set(row.id, row);
      return Promise.resolve(row);
    },
    update: (spaceId, id, data) => {
      const previous = rows.get(id);
      if (previous?.spaceId !== spaceId) throw new Error("missing");
      const row = {
        ...previous,
        ...data,
        ts: data.ts ?? previous.ts,
        items: data.items ?? previous.items,
        totalCarbs: data.totalCarbs ?? previous.totalCarbs,
      };
      rows.set(id, row);
      return Promise.resolve(row);
    },
    delete: (_spaceId, id) => {
      rows.delete(id);
      return Promise.resolve();
    },
  };
  const emit: EmitFn = (spaceId, type, payload) => {
    events.push(type);
    return Promise.resolve(
      EventEnvelope.parse({
        spaceId,
        seq: events.length,
        type,
        payload: EventPayloads[type].parse(payload),
        ts: at.toISOString(),
      }),
    );
  };
  photos = new MemoryPhotoStore();
  configureMeals({
    sessionDb: auth.db,
    repo,
    photos,
    write: (work) => work(repo, emit),
    now: () => at,
  });
});
afterEach(() => {
  configureMeals({});
  vi.restoreAllMocks();
});

describe("meal routes", () => {
  it("creates, reads, corrects, saves/removes a photo and deletes with exactly one event per write", async () => {
    const created = await POST(
      request("POST", "carer", {
        items: [{ name: "Fictional toast", carbs: 12 }],
        note: "Fictional note",
      }),
      ctx(),
    );
    expect(created.status).toBe(201);
    const body = (await created.json()) as { id: string };
    expect(events).toEqual(["meal.created"]);
    const read = await GET(request("GET"), ctx(body.id));
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({
      title: "Fictional note",
      slot: "snack",
      totalCarbs: 12,
      byUser: { id: "carer" },
      items: [{ name: "Fictional toast", carbs: 12 }],
    });
    expect(events).toHaveLength(1);
    const patched = await PATCH(
      request("PATCH", "carer", { items: [{ name: "Fictional oats", carbs: 17 }], note: "" }),
      ctx(body.id),
    );
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({ title: "Fictional oats", totalCarbs: 17 });
    const photo = await PUT(request("PUT", "carer", { photoDataUrl: png }), ctx(body.id));
    expect(photo.status).toBe(200);
    expect(await photo.json()).toHaveProperty(
      "photo.thumbUrl",
      expect.stringContaining("thumb.jpg"),
    );
    expect((await DELETE_PHOTO(request("DELETE"), ctx(body.id))).status).toBe(200);
    expect((await DELETE(request("DELETE"), ctx(body.id))).status).toBe(204);
    expect((await GET(request("GET"), ctx(body.id))).status).toBe(404);
    expect(events).toEqual([
      "meal.created",
      "meal.updated",
      "meal.updated",
      "meal.updated",
      "meal.deleted",
    ]);
    expect(rows.size).toBe(0);
    expect(logs.all()).not.toMatch(/Fictional|toast|oats|note|data:image/);
    expect(logs.all()).toContain('"count":1');
  });
  it("returns photo-unavailable for a configured store outage without a meal or event write", async () => {
    const put = photos.put.bind(photos);
    vi.spyOn(photos, "put").mockImplementation(async (key, bytes) => {
      await put(key, bytes);
      throw new Error("photo-unavailable");
    });
    const response = await POST(
      request("POST", "carer", {
        items: [{ name: "Fictional toast", carbs: 12 }],
        photoDataUrl: png,
      }),
      ctx(),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toHaveProperty("error.code", "photo-unavailable");
    expect(rows.size).toBe(0);
    expect(events).toHaveLength(0);
    expect(photos.photos.size).toBe(0);
    expect(logs.all()).not.toMatch(/Fictional|toast|data:image/);
  });
  it("rejects every meal route for viewers, missing sessions and non-members before any write", async () => {
    for (const [handler, method] of [
      [POST, "POST"],
      [GET, "GET"],
      [PATCH, "PATCH"],
      [DELETE, "DELETE"],
      [PUT, "PUT"],
      [DELETE_PHOTO, "DELETE"],
    ] as const) {
      expect(
        (
          await handler(
            request(
              method,
              "viewer",
              method === "POST" || method === "PATCH" || method === "PUT" ? {} : undefined,
            ),
            ctx(),
          )
        ).status,
      ).toBe(403);
      expect((await handler(request(method, "unknown"), ctx())).status).toBe(403);
      expect((await handler(request(method), ctx("m1", "other-space"))).status).toBe(404);
    }
    expect(events).toHaveLength(0);
    expect(rows.size).toBe(0);
  });
  it("validates requests without leaking input and forbids simpleMode timestamps on both writes", async () => {
    expect((await POST(request("POST", "carer", { items: [] }), ctx())).status).toBe(400);
    const created = await POST(
      request("POST", "carer", { items: [{ name: "Fictional toast", carbs: 12 }] }),
      ctx(),
    );
    const { id } = (await created.json()) as { id: string };
    const db = auth.db;
    const find = db.session.findUnique.bind(db.session);
    db.session.findUnique = vi.fn(async (args: { where: { id: string } }) => {
      const row = await find({ ...args, include: { user: { include: { memberships: true } } } });
      return row ? { ...row, user: { ...row.user, simpleMode: true } } : null;
    }) as unknown as typeof find;
    configureMeals({ sessionDb: db, repo, photos: null });
    const response = await POST(
      request("POST", "carer", {
        items: [{ name: "Fictional toast", carbs: 12 }],
        bolusTs: at.toISOString(),
      }),
      ctx(),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toHaveProperty("error.code", "simple-mode");
    expect(
      (await PATCH(request("PATCH", "carer", { bolusTs: at.toISOString() }), ctx(id))).status,
    ).toBe(400);
    expect((await PUT(request("PUT", "carer", { photoDataUrl: png }), ctx(id))).status).toBe(503);
    expect((await DELETE_PHOTO(request("DELETE"), ctx(id))).status).toBe(503);
    expect(events).toEqual(["meal.created"]);
    expect(logs.all()).not.toMatch(/Fictional|toast|data:image/);
  });
});

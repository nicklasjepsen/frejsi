// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEnvelope, EventPayloads, type EmitFn } from "@frejsi/shared";
import { MemoryPhotoStore } from "@frejsi/shared/photos/memory";
import { FakeLiveDb, captureLog } from "@/lib/live/test-support";
import type { MealRecord, MealRepository } from "@/lib/meals/repository";
import { configureMeals } from "@/lib/meals/server";
import { bolus, mealRow, writerHarness } from "@/lib/meals/test-support";
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
let clock: Date;
beforeEach(() => {
  clock = at;
  auth = new FakeLiveDb(() => at);
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
        bolusTs: data.bolusTs === null ? undefined : (data.bolusTs ?? previous.bolusTs),
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
    now: () => clock,
  });
});
afterEach(() => {
  configureMeals({});
  vi.restoreAllMocks();
});

describe("meal routes", () => {
  it("rejects a session exactly at expiry by the meal clock before writing", async () => {
    clock = new Date(at.getTime() + 60 * 60 * 1000);
    const response = await POST(
      request("POST", "carer", { items: [{ name: "Fictional toast", carbs: 12 }] }),
      ctx(),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "forbidden" } });
    expect(rows.size).toBe(0);
    expect(events).toEqual([]);
    expect(auth.updates).toEqual([]);
  });

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
  it.each(["owner", "carer"])(
    "%s can clear a saved timestamp; omission preserves it",
    async (user) => {
      auth.addMember("owner", "s1", "owner");
      const created = await POST(
        request("POST", user, {
          items: [{ name: "Fictional toast", carbs: 12 }],
          bolusTs: at.toISOString(),
        }),
        ctx(),
      );
      const { id } = (await created.json()) as { id: string };
      const unchanged = await PATCH(request("PATCH", user, { note: "Fictional edit" }), ctx(id));
      expect(unchanged.status).toBe(200);
      expect(await unchanged.json()).toHaveProperty("bolusTs", at.toISOString());
      const denied = await PATCH(request("PATCH", "viewer", { bolusTs: null }), ctx(id));
      expect(denied.status).toBe(403);
      expect(rows.get(id)?.bolusTs).toBe(at.toISOString());
      expect(events).toEqual(["meal.created", "meal.updated"]);
      const cleared = await PATCH(request("PATCH", user, { bolusTs: null }), ctx(id));
      expect(cleared.status).toBe(200);
      expect(await cleared.json()).not.toHaveProperty("bolusTs");
      const read = await GET(request("GET", user), ctx(id));
      expect(await read.json()).not.toHaveProperty("bolusTs");
      expect(events).toEqual(["meal.created", "meal.updated", "meal.updated"]);
    },
  );

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
    configureMeals({ sessionDb: db, repo, photos: null, now: () => clock });
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
    const clear = await PATCH(request("PATCH", "carer", { bolusTs: null }), ctx(id));
    expect(clear.status).toBe(400);
    expect(await clear.json()).toHaveProperty("error.code", "simple-mode");
    expect((await PUT(request("PUT", "carer", { photoDataUrl: png }), ctx(id))).status).toBe(503);
    expect((await DELETE_PHOTO(request("DELETE"), ctx(id))).status).toBe(503);
    expect(events).toEqual(["meal.created"]);
    expect(logs.all()).not.toMatch(/Fictional|toast|data:image/);
  });
});

describe("pump meals on the meal routes (v0.7.0 plan §6)", () => {
  const t = (hhmm: string) => new Date(`2026-10-15T${hhmm}:00.000Z`);
  function pumpSetup() {
    auth.addMember("owner", "s1", "owner");
    auth.addMember("child", "s1", "carer");
    const child = auth.users.find((user) => user.id === "child");
    if (child) child.simpleMode = true;
    const h = writerHarness();
    h.boluses.set("b1", bolus({ id: "b1", ts: t("11:50"), units: 2.4, carbs: 45 }));
    h.boluses.set("b2", bolus({ id: "b2", ts: t("07:55"), units: 1.5, carbs: 20 }));
    h.rows.set(
      "pm1",
      mealRow({
        id: "pm1",
        ts: t("11:50"),
        totalCarbs: 45,
        source: "pump",
        pumpBolusId: "b1",
        bolusTs: t("11:50"),
      }),
    );
    h.rows.set(
      "breakfast",
      mealRow({ id: "breakfast", ts: t("08:00"), pumpBolusId: "b2", bolusTs: t("07:55") }),
    );
    h.rows.set("tapped", mealRow({ id: "tapped", ts: t("18:00"), bolusTs: t("17:50") }));
    configureMeals({ sessionDb: auth.db, repo: h.repo, photos, write: h.write, now: () => clock });
    return h;
  }
  const body = async (response: Response) => (await response.json()) as Record<string, unknown>;

  it.each(["owner", "carer"])(
    "%s adopts a pump meal with 'Det passer': source cleared, meal.updated",
    async (user) => {
      const h = pumpSetup();
      expect(await body(await GET(request("GET", user), ctx("pm1")))).toMatchObject({
        fromPump: true,
        bolusUnits: 2.4,
        pumpCarbs: 45,
      });
      const adopted = await PATCH(request("PATCH", user, { adopt: true }), ctx("pm1"));
      expect(adopted.status).toBe(200);
      const view = await body(adopted);
      expect(view).not.toHaveProperty("fromPump");
      expect(view).toMatchObject({ pumpBolusId: "b1", bolusUnits: 2.4, pumpCarbs: 45 });
      expect(h.rows.get("pm1")?.source).toBeNull();
      expect(h.events.map((e) => e.type)).toEqual(["meal.updated"]);
      expect(h.sink.published.map((p) => p.group)).toEqual(["space-s1"]);
    },
  );
  it("clears source on any other edit of a pump meal, and adopt on an ordinary meal changes nothing", async () => {
    const h = pumpSetup();
    const edited = await PATCH(
      request("PATCH", "carer", { items: [{ name: "Fictional pasta", carbs: 50 }] }),
      ctx("pm1"),
    );
    expect(edited.status).toBe(200);
    expect(await body(edited)).not.toHaveProperty("fromPump");
    expect(h.rows.get("pm1")).toMatchObject({ source: null, totalCarbs: 50 });
    expect(h.events.map((e) => e.type)).toEqual(["meal.updated"]);
    const before = structuredClone(h.rows.get("breakfast"));
    const noop = await PATCH(request("PATCH", "carer", { adopt: true }), ctx("breakfast"));
    expect(noop.status).toBe(200);
    expect(await body(noop)).toMatchObject({ id: "breakfast", pumpBolusId: "b2" });
    expect(h.rows.get("breakfast")).toEqual(before);
    expect(h.events).toHaveLength(1);
    expect(h.isolation).toHaveLength(1);
  });
  it("leaves an untouched pump meal alone when the request changes nothing", async () => {
    const h = pumpSetup();
    const before = structuredClone(h.rows.get("pm1"));
    const res = await PATCH(request("PATCH", "carer", {}), ctx("pm1"));
    expect(res.status).toBe(200);
    expect(await body(res)).toMatchObject({ id: "pm1", fromPump: true });
    expect(h.rows.get("pm1")).toEqual(before);
    expect(h.events).toHaveLength(0);
  });
  it("sets mealDismissed when an owner or carer deletes a pump meal", async () => {
    const h = pumpSetup();
    expect((await DELETE(request("DELETE", "owner"), ctx("pm1"))).status).toBe(204);
    expect(h.boluses.get("b1")?.mealDismissed).toBe(true);
    expect(h.events.map((e) => e.type)).toEqual(["meal.deleted"]);
    expect((await DELETE(request("DELETE", "viewer"), ctx("breakfast"))).status).toBe(403);
    expect(h.boluses.get("b2")?.mealDismissed).toBe(false);
  });
  it("answers 404 to simpleMode for a pump meal and shows it no pump field on any meal", async () => {
    const h = pumpSetup();
    for (const [handler, method, payload] of [
      [GET, "GET", undefined],
      [PATCH, "PATCH", { adopt: true }],
      [PATCH, "PATCH", { note: "Fictional" }],
      [DELETE, "DELETE", undefined],
    ] as const) {
      const response = await handler(request(method, "child", payload), ctx("pm1"));
      expect(response.status, method).toBe(404);
      expect(await body(response)).toHaveProperty("error.code", "not-found");
    }
    expect(h.rows.get("pm1")?.source).toBe("pump");
    expect(h.boluses.get("b1")?.mealDismissed).toBe(false);
    expect(h.events).toEqual([]);
    const linked = await body(await GET(request("GET", "child"), ctx("breakfast")));
    for (const key of ["bolusUnits", "pumpCarbs", "pumpBolusId", "fromPump", "bolusTs"])
      expect(linked, key).not.toHaveProperty(key);
    // A bolus time tapped before v0.7.0 is not from the pump and stays as it was.
    expect(await body(await GET(request("GET", "child"), ctx("tapped")))).toHaveProperty(
      "bolusTs",
      t("17:50").toISOString(),
    );
    // The same meal for a carer outside simpleMode carries the pump record.
    expect(await body(await GET(request("GET", "carer"), ctx("breakfast")))).toMatchObject({
      bolusTs: t("07:55").toISOString(),
      bolusUnits: 1.5,
      pumpCarbs: 20,
      pumpBolusId: "b2",
    });
    expect(logs.all()).not.toMatch(/2\.4|1\.5|Fictional/);
  });
});

// @vitest-environment node
import { createLogger, FoodView } from "@frejsi/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAuthDb } from "@/lib/auth/test-support";
import {
  seedSpace,
  request,
  params,
  USERS,
  type Who,
  T0,
} from "@/components/settings/route-test-support";
import { foodTestRig, candidate } from "@/lib/foods/test-fixture.test";
import { configureFoods } from "@/lib/foods/core";
import { GET, POST } from "./route";
import { GET as get, PATCH, DELETE } from "./[foodId]/route";
import { POST as verify } from "./verify/route";
import { PUT as putPhoto, DELETE as deletePhoto } from "./[foodId]/photo/route";

let rig: ReturnType<typeof foodTestRig>;
let auth: FakeAuthDb;
let lines: string[];
beforeEach(() => {
  vi.useFakeTimers({ now: T0, toFake: ["Date"] });
  rig = foodTestRig();
  rig.deps.now = () => T0;
  auth = new FakeAuthDb(() => T0);
  seedSpace(auth);
  lines = [];
  configureFoods({
    ...rig.deps,
    sessionDb: auth.db,
    log: createLogger((line) => lines.push(line)),
  });
});
afterEach(() => {
  rig.reset();
  vi.useRealTimers();
});
type Handler = (
  req: Request,
  context: { params: Promise<{ spaceId: string; foodId: string }> },
) => Promise<Response>;
function call(
  handler: Handler,
  method = "GET",
  body?: unknown,
  as: Who | null = "carer",
  foodId = "a",
  query = "",
) {
  return handler(
    request(`/api/spaces/s1/foods${query}`, {
      as,
      method,
      ...(body !== undefined ? { body } : {}),
    }),
    params({ spaceId: "s1", foodId }),
  );
}
const foodFields = { name: "Cloud pear", carbsPer100g: 12.5, portions: [] };

it("lists visible foods and counts without emitting and returns only the shared FoodView keys", async () => {
  rig.seed({ id: "a", verified: true });
  rig.seed({ id: "b" });
  let res = await call(GET);
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    foods: unknown[];
    counts: { all: number; unverified: number };
  };
  expect(body.counts).toMatchObject({ all: 2, unverified: 1 });
  for (const food of body.foods) expect(FoodView.safeParse(food).success).toBe(true);
  Object.assign(auth.rows("user").find((u) => u.id === USERS.carer) ?? {}, { simpleMode: true });
  res = await call(GET, "GET", undefined, "carer", "a", "?simpleMode=false");
  expect(((await res.json()) as { foods: { id: string }[] }).foods.map((food) => food.id)).toEqual([
    "a",
  ]);
  expect((await call(get, "GET", undefined, "carer", "b")).status).toBe(404);
  expect(rig.events).toEqual([]);
});

it("creates fields or candidates, verifies on request, and counts each emitted event", async () => {
  const res = await call(POST, "POST", { ...foodFields, from: "library", verify: true });
  expect(res.status).toBe(201);
  const food = FoodView.parse(await res.json());
  expect(food).toMatchObject({ origin: "family", verified: true, verifiedBy: USERS.carer });
  expect(rig.events.map((e) => e.type)).toEqual(["food.created", "food.verified"]);
  expect((await call(POST, "POST", { candidate })).status).toBe(201);
  expect((await call(POST, "POST", { candidate })).status).toBe(201);
  expect(rig.events.map((e) => e.type)).toEqual(["food.created", "food.verified", "food.created"]);
});

it("reads, patches, verifies and deletes a space food and preserves meal snapshots", async () => {
  rig.seed({ id: "a" });
  expect((await call(get)).status).toBe(200);
  expect(rig.events).toHaveLength(0);
  expect((await call(PATCH, "PATCH", { name: "Silver pear" })).status).toBe(200);
  expect((await call(verify, "POST", { foodIds: ["a"] })).status).toBe(200);
  rig.items.push({ foodId: "a", name: "Earlier pear", carbs: 14, meal: { spaceId: "s1", ts: T0 } });
  expect((await call(DELETE, "DELETE")).status).toBe(204);
  expect(rig.items[0]).toMatchObject({ foodId: null, name: "Earlier pear", carbs: 14 });
  expect(rig.events.map((e) => e.type)).toEqual(["food.updated", "food.verified", "food.deleted"]);
});

it("processes a photo upload and deletion, with one update event each", async () => {
  rig.seed({ id: "a" });
  const bytes = Buffer.from("UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=", "base64");
  const req = new Request("https://frejsi.example/api/spaces/s1/foods/a/photo", {
    method: "PUT",
    headers: { cookie: "frejsi_session=sess-carer", "content-type": "image/webp" },
    body: bytes,
  });
  const res = await putPhoto(req, params({ spaceId: "s1", foodId: "a" }));
  expect(res.status).toBe(200);
  expect(FoodView.parse(await res.json()).photo?.thumbUrl).toContain("/spaces/s1/foods/a/");
  expect((await call(deletePhoto, "DELETE")).status).toBe(200);
  expect(rig.events.map((e) => e.type)).toEqual(["food.updated", "food.updated"]);
});

it("refuses unavailable stores, unsupported uploads, excessive bytes and invalid bodies without emitting", async () => {
  rig.seed({ id: "a" });
  const invalid = await call(putPhoto, "PUT", "not an image");
  expect(invalid.status).toBe(400);
  expect(await invalid.json()).toMatchObject({ error: { code: "photo-type" } });
  const req = new Request("https://frejsi.example/photo", {
    method: "PUT",
    headers: { cookie: "frejsi_session=sess-carer" },
    body: new Uint8Array(8 * 1024 * 1024 + 1),
  });
  expect(await (await putPhoto(req, params({ spaceId: "s1", foodId: "a" }))).json()).toMatchObject({
    error: { code: "photo-too-large" },
  });
  configureFoods({ ...rig.deps, sessionDb: auth.db, photos: null });
  expect((await call(putPhoto, "PUT", "anything")).status).toBe(503);
  expect((await call(deletePhoto, "DELETE")).status).toBe(503);
  expect((await call(POST, "POST", { ...foodFields, verified: true })).status).toBe(400);
  expect((await call(POST, "POST", { ...foodFields, candidate })).status).toBe(400);
  expect((await call(PATCH, "PATCH", {})).status).toBe(400);
  expect((await call(verify, "POST", { foodIds: [] })).status).toBe(400);
  expect(rig.events).toEqual([]);
});

const endpoints = [
  [GET, "GET", undefined],
  [POST, "POST", foodFields],
  [get, "GET", undefined],
  [PATCH, "PATCH", { name: "Silver pear" }],
  [DELETE, "DELETE", undefined],
  [verify, "POST", { foodIds: ["a"] }],
  [putPhoto, "PUT", "bytes"],
  [deletePhoto, "DELETE", undefined],
] as const;
describe.each(endpoints)("role gate on endpoint %#", (handler, method, body) => {
  it("returns 403 for a viewer or no session and 404 for a non-member, without events", async () => {
    rig.seed({ id: "a" });
    for (const [as, status] of [
      ["viewer", 403],
      [null, 403],
      ["stranger", 404],
    ] as const) {
      const res = await call(handler, method, body, as);
      expect(res.status).toBe(status);
      expect(await res.json()).toEqual({
        error: {
          code: status === 403 ? "forbidden" : "not-found",
          message: status === 403 ? "forbidden" : "not-found",
        },
      });
    }
    expect(rig.events).toEqual([]);
    expect(rig.rows).toHaveLength(1);
  });
});

it("rejects cache and other-space ids on every single-food route and mixed verify batch", async () => {
  rig.seed({ id: "a" });
  rig.seed({ id: "foreign", spaceId: "s2" });
  rig.seed({ id: "cache", spaceId: null });
  for (const id of ["foreign", "cache", "missing"]) {
    for (const [handler, method, body] of [
      [get, "GET", undefined],
      [PATCH, "PATCH", { name: "Changed" }],
      [DELETE, "DELETE", undefined],
      [putPhoto, "PUT", "bytes"],
      [deletePhoto, "DELETE", undefined],
    ] as const) {
      expect((await call(handler, method, body, "owner", id)).status).toBe(404);
    }
    expect((await call(verify, "POST", { foodIds: ["a", id] })).status).toBe(404);
  }
  expect(rig.events).toEqual([]);
});

it("simpleMode cannot verify directly or while creating, and logs contain ids/codes only", async () => {
  rig.seed({ id: "a" });
  Object.assign(auth.rows("user").find((u) => u.id === USERS.carer) ?? {}, { simpleMode: true });
  for (const [handler, body] of [
    [verify, { foodIds: ["a"] }],
    [POST, { ...foodFields, verify: true }],
  ] as const) {
    const res = await call(handler, "POST", body);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "simple-mode" } });
  }
  Object.assign(auth.rows("user").find((u) => u.id === USERS.carer) ?? {}, { simpleMode: false });
  await call(PATCH, "PATCH", { name: "Secret fictional pear", barcode: "2000000000015" });
  await call(verify, "POST", { foodIds: ["a"] });
  await call(GET);
  expect(lines.length).toBeGreaterThanOrEqual(5);
  for (const line of lines) {
    const entry = JSON.parse(line) as Record<string, unknown>;
    expect(entry.spaceId).toBe("s1");
    expect(entry.userId).toBe(USERS.carer);
    expect(typeof entry.code).toBe("string");
    for (const key of Object.keys(entry))
      expect([
        "ts",
        "level",
        "msg",
        "route",
        "spaceId",
        "userId",
        "foodId",
        "count",
        "code",
      ]).toContain(key);
  }
  expect(lines.join("\n")).not.toMatch(
    /Secret fictional pear|2000000000015|Cloud pear|thumbUrl|sess-carer/,
  );
  expect(rig.events.map((e) => e.type)).toEqual(["food.updated", "food.verified"]);
});

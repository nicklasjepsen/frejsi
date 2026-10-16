// @vitest-environment node
import { createLogger } from "@frejsi/shared";
import { FakeFoodContributor } from "@frejsi/shared/food/fake-contributor";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAuthDb } from "@/lib/auth/test-support";
import {
  seedSpace,
  request,
  params,
  USERS,
  T0,
  type Who,
} from "@/components/settings/route-test-support";
import { configureContributions } from "@/lib/contributions";
import { configureFoods } from "@/lib/foods/core";
import { foodTestRig } from "@/lib/foods/test-fixture.test";
import { PATCH } from "../foods/[foodId]/route";
import { GET, POST } from "./route";

const BARCODE = "2000000000008";
let rig: ReturnType<typeof foodTestRig>;
let auth: FakeAuthDb;
let lines: string[];
let fake: FakeFoodContributor;
beforeEach(() => {
  vi.useFakeTimers({ now: T0, toFake: ["Date"] });
  rig = foodTestRig();
  rig.deps.now = () => T0;
  auth = new FakeAuthDb(() => T0);
  seedSpace(auth);
  lines = [];
  fake = new FakeFoodContributor();
  configureFoods({
    ...rig.deps,
    sessionDb: auth.db,
    log: createLogger((line) => lines.push(line)),
  });
  configureContributions([fake]);
  rig.seed({
    id: "a",
    origin: "off",
    sourceRef: "off:2000000000008",
    barcode: BARCODE,
    name: "Fictional oat bar",
    carbsPer100g: 52.5,
    portions: JSON.stringify([
      { label: "1 bar", carbs: 14 },
      { label: "1 pack", grams: 40, carbs: 21 },
    ]),
  });
});
afterEach(() => {
  rig.reset();
  configureContributions();
  vi.useRealTimers();
});
const get = (as: Who | null = "carer", spaceId = "s1") =>
  GET(request(`/api/spaces/${spaceId}/contributions`, { as }), params({ spaceId }));
const post = (body: unknown, as: Who | null = "carer", spaceId = "s1") =>
  POST(
    request(`/api/spaces/${spaceId}/contributions`, { as, method: "POST", body }),
    params({ spaceId }),
  );
const setSimple = () =>
  Object.assign(auth.rows("user").find((u) => u.id === USERS.carer) ?? {}, { simpleMode: true });

describe("GET contributions", () => {
  it("lists the configured contributors for owner and carer", async () => {
    for (const who of ["owner", "carer"] as const) {
      const res = await get(who);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ available: ["off"] });
    }
  });
  it("lists none when no contributor is configured", async () => {
    configureContributions([]);
    expect(await (await get()).json()).toEqual({ available: [] });
  });
  it("gates viewer 403, no session 403 and non-member 404", async () => {
    expect((await get("viewer")).status).toBe(403);
    expect((await get(null)).status).toBe(403);
    expect((await get("stranger")).status).toBe(404);
  });
});

describe("POST contributions", () => {
  it("sends the current numbers once, with a pseudonymous app reference and no name, then emits", async () => {
    const before = structuredClone(rig.rows);
    const res = await post({ foodId: "a" });
    expect(res.status).toBe(200);
    expect(fake.corrections).toEqual([
      {
        barcode: BARCODE,
        carbsPer100g: 52.5,
        servingSize: { grams: 40 },
        appRef: fake.corrections[0]?.appRef,
      },
    ]);
    expect(fake.corrections[0]?.appRef).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(fake.corrections)).not.toContain("oat");
    expect(rig.events.map((e) => [e.type, e.payload])).toEqual([
      ["food.contributed", { foodId: "a", source: "off" }],
    ]);
    expect(rig.rows).toEqual(before);
  });
  it("derives the app reference from sha256 of the space id", async () => {
    await post({ foodId: "a" });
    const { createHash } = await import("node:crypto");
    expect(fake.corrections[0]?.appRef).toBe(
      createHash("sha256").update("s1").digest("hex").slice(0, 32),
    );
  });
  it.each(["bad-credentials", "rejected", "error"] as const)(
    "answers 502 contribution-rejected for %s and emits nothing",
    async (status) => {
      configureContributions([new FakeFoodContributor({ script: [status] })]);
      const res = await post({ foodId: "a" });
      expect(res.status).toBe(502);
      expect(await res.json()).toMatchObject({ error: { code: "contribution-rejected" } });
      expect(rig.events).toEqual([]);
    },
  );
  it("answers 429 for rate-limited and emits nothing", async () => {
    configureContributions([new FakeFoodContributor({ script: ["rate-limited"] })]);
    expect((await post({ foodId: "a" })).status).toBe(429);
    expect(rig.events).toEqual([]);
  });
  it("treats a contributor that throws as a failed send", async () => {
    configureContributions([
      { id: "off", contribute: () => Promise.reject(new Error("secret 2000000000008")) },
    ]);
    expect((await post({ foodId: "a" })).status).toBe(502);
    expect(rig.events).toEqual([]);
  });
  it("is 404 for another origin, a food without a barcode, another space's food and an unknown id", async () => {
    rig.seed({ id: "frida", origin: "frida", sourceRef: "frida:1", barcode: BARCODE });
    rig.seed({ id: "nobar", origin: "off", sourceRef: "off:2", barcode: null });
    rig.seed({ id: "other", spaceId: "s2", origin: "off", sourceRef: "off:3", barcode: BARCODE });
    for (const foodId of ["frida", "nobar", "other", "missing"])
      expect((await post({ foodId })).status).toBe(404);
    expect(fake.corrections).toEqual([]);
  });
  it("is 503 contribution-unavailable without a contributor, before any lookup", async () => {
    configureContributions([]);
    const res = await post({ foodId: "a" });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: "contribution-unavailable" } });
  });
  it("gates viewer 403, non-member 404 and simpleMode 400 before any call", async () => {
    expect((await post({ foodId: "a" }, "viewer")).status).toBe(403);
    expect((await post({ foodId: "a" }, "stranger")).status).toBe(404);
    expect((await post({ foodId: "a" }, null)).status).toBe(403);
    setSimple();
    const res = await post({ foodId: "a" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "simple-mode" } });
    expect(fake.corrections).toEqual([]);
    expect(rig.events).toEqual([]);
  });
  it("rejects a malformed body", async () => {
    expect((await post({})).status).toBe(400);
    expect((await post({ foodId: "a", name: "x" })).status).toBe(400);
    expect(fake.corrections).toEqual([]);
  });
  it("never contributes from a food edit", async () => {
    const res = await PATCH(
      request("/api/spaces/s1/foods/a", {
        as: "carer",
        method: "PATCH",
        body: { carbsPer100g: 50 },
      }),
      params({ spaceId: "s1", foodId: "a" }),
    );
    expect(res.status).toBe(200);
    expect(fake.corrections).toEqual([]);
    expect(rig.events.map((e) => e.type)).toEqual(["food.updated"]);
  });
  it("logs spaceId, userId, code and ms only: never the barcode, a value or the name", async () => {
    await post({ foodId: "a" });
    configureContributions([new FakeFoodContributor({ script: ["rejected"] })]);
    await post({ foodId: "a" });
    const mine = lines.filter((line) => line.includes("contributions."));
    expect(mine).toHaveLength(2);
    for (const line of mine) {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      expect(Object.keys(parsed).sort()).toEqual(
        ["code", "level", "ms", "msg", "route", "spaceId", "ts", "userId"].sort(),
      );
      expect(line).not.toMatch(/2000000000008|52\.5|oat/);
    }
    expect(lines.join("")).not.toMatch(/2000000000008|52\.5|oat/);
  });
});

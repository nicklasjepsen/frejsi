// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { HttpError } from "@frejsi/shared";
import { FakeAiProvider } from "@frejsi/shared/ai/fake";
import { CappedAiProvider } from "@frejsi/shared/ai/capped";
import { MemoryAiCallRepository } from "@frejsi/shared/ai/calls";
import { MemoryFoodRepository } from "@frejsi/shared/food/memory";
import { FakeFoodSource } from "@frejsi/shared/food/fake";
import { FakeLiveDb, captureLog, liveRequest, spaceContext } from "@/lib/live/test-support";
import { configureParse } from "./server";
import { GET, POST } from "./route";

const meal = { items: [], unmatched: ["toast"] };
function setup(simpleMode = false, failure?: HttpError, cap = 50) {
  const auth = new FakeLiveDb(() => new Date());
  auth.addSpace("s1");
  for (const role of ["owner", "carer", "viewer"] as const) auth.addMember(role, "s1", role);
  auth.addMember("other", "s2", "carer");
  const db = auth.db;
  const original = db.session.findUnique.bind(db.session);
  db.session.findUnique = vi.fn(async (args: { where: { id: string } }) => {
    const row = await original({ ...args, include: { user: { include: { memberships: true } } } });
    return row ? { ...row, user: { ...row.user, simpleMode, locale: "en" } } : null;
  }) as unknown as typeof original;
  const fake = new FakeAiProvider([
    {
      kind: "tool-calls",
      model: "fixture",
      calls: [{ id: "1", name: "lookup", input: { query: "toast" } }],
    },
    { kind: "json", json: meal, model: "fixture" },
  ]);
  const source = new FakeFoodSource({ id: "fake-remote", kind: "remote" });
  const calls = new MemoryAiCallRepository();
  configureParse({
    sessionDb: db,
    repo: new MemoryFoodRepository(),
    sources: [source],
    enabled: () => Promise.resolve(failure?.code !== "ai-disabled"),
    provider: () => {
      if (failure) return Promise.reject(failure);
      return Promise.resolve(
        new CappedAiProvider(fake, calls, { spaceId: "s1", timezone: "UTC", dailyCap: cap }),
      );
    },
  });
  return { fake, source };
}
function post(user = "carer", body: unknown = { text: "Example toast" }) {
  const req = liveRequest("s1", "parse", `sess-${user}`);
  return POST(
    new Request(req, { method: "POST", headers: req.headers, body: JSON.stringify(body) }),
    spaceContext("s1"),
  );
}
afterEach(() => {
  configureParse({});
  vi.restoreAllMocks();
});
it.each(["owner", "carer"])(
  "parses for %s using the real lookup and logs only metadata",
  async (role) => {
    const { source, fake } = setup();
    const logs = captureLog();
    const response = await post(role);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(meal);
    expect(source.calls).toEqual([{ method: "search", q: "toast", locale: "en" }]);
    expect(fake.calls).toHaveLength(2);
    expect(logs.all()).not.toMatch(/toast|Example/);
    expect(logs.all()).toContain('"count":1');
  },
);
it.each([
  ["viewer", false, 403],
  ["other", false, 404],
  ["carer", true, 400],
] as const)("rejects %s simple=%s before AI", async (user, simple, status) => {
  const { fake } = setup(simple);
  expect((await post(user)).status).toBe(status);
  expect(fake.calls).toEqual([]);
});
it.each([
  [409, "ai-disabled"],
  [503, "ai-unavailable"],
  [503, "ai-not-configured"],
] as const)("preserves %s %s", async (status, code) => {
  setup(false, new HttpError(status, code));
  const response = await post();
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({ error: { code, message: code } });
});
it("enforces the daily cap and validates text before calling AI", async () => {
  const { fake } = setup(false, undefined, 0);
  expect((await post()).status).toBe(429);
  expect((await post("carer", { text: "" })).status).toBe(400);
  expect(fake.calls).toEqual([]);
});

it.each(["owner", "carer"])("provides visibility for %s without a provider call", async (user) => {
  const { fake } = setup();
  const response = await GET(liveRequest("s1", "parse", `sess-${user}`), spaceContext("s1"));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ enabled: true });
  expect(fake.calls).toEqual([]);
});
it.each([
  ["viewer", false, 403],
  ["other", false, 404],
  ["carer", true, 200],
] as const)("gates visibility for %s simple=%s", async (user, simple, status) => {
  const { fake } = setup(simple);
  const response = await GET(liveRequest("s1", "parse", `sess-${user}`), spaceContext("s1"));
  expect(response.status).toBe(status);
  if (simple) expect(await response.json()).toEqual({ enabled: false });
  expect(fake.calls).toEqual([]);
});
it("reports opt-out through the visibility adapter", async () => {
  const { fake } = setup(false, new HttpError(409, "ai-disabled"));
  const response = await GET(liveRequest("s1", "parse", "sess-carer"), spaceContext("s1"));
  expect(await response.json()).toEqual({ enabled: false });
  expect(fake.calls).toEqual([]);
});

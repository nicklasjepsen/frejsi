import { expect, it, vi } from "vitest";
vi.mock("@azure/functions", () => ({ app: { timer: vi.fn() } }));
import { Food } from "@frejsi/shared/schemas/food";
import { createLogger, type EmitFn } from "@frejsi/shared";
import { FakeAiProvider, type RecordedAiCall } from "@frejsi/shared/ai/fake";
import { MemoryAiCallRepository } from "@frejsi/shared/ai/calls";
import { MemoryFoodRepository } from "@frejsi/shared/food/memory";
import { runEnrichment, SCHEDULE } from "./enrich-foods";
const vector = [1, ...Array<number>(1023).fill(0)];
const row = (id: string, spaceId: string | null, fields = {}) =>
  Food.parse({
    id,
    spaceId,
    name: "EXAMPLE LOAF 900G",
    nameSearch: "example loaf 900g",
    origin: "remote-test",
    sourceRef: "remote-test:loaf",
    carbsPer100g: 40,
    portions: [],
    verified: false,
    createdAt: "2026-10-15T12:00:00Z",
    updatedAt: "2026-10-15T12:00:00Z",
    ...fields,
  });
function rig() {
  const repo = new MemoryFoodRepository([
    row("cache", null),
    row("space", "s1"),
    row("edited", "s1", { name: "My loaf", sourceName: "EXAMPLE LOAF 900G" }),
    row("off", "off"),
    row("ai", "s1", { origin: "ai" }),
    row("typed", "s1", { origin: "manual" }),
    row("verified", "s1", {
      sourceRef: "remote-test:verified",
      verified: true,
      verifiedBy: "u1",
      portions: [{ label: "slice", carbs: 18 }],
    }),
  ]);
  const script = (call: RecordedAiCall) =>
    call.kind === "embed"
      ? { vectors: call.request.texts.map(() => vector), model: "fixture" }
      : {
          kind: "json" as const,
          json: { name: "Example loaf", portions: [{ label: "1 slice", grams: 45, carbs: 18 }] },
          model: "fixture",
        };
  const cache = new FakeAiProvider(script),
    space = new FakeAiProvider(script);
  const calls = new MemoryAiCallRepository();
  const events: unknown[] = [];
  const emit = ((spaceId, type, payload) => {
    events.push({ spaceId, type, payload });
    return Promise.resolve({});
  }) as EmitFn;
  const logs: string[] = [];
  const deps = {
    repo,
    calls,
    emit,
    providers: { anthropic: cache, ollama: space },
    remoteOrigins: ["remote-test"],
    spaces: [
      {
        id: "s1",
        aiProvider: "ollama",
        aiEnabled: true,
        timezone: "Europe/Copenhagen",
        locale: "en" as const,
      },
      { id: "off", aiProvider: "ollama", aiEnabled: false, timezone: "UTC", locale: "da" as const },
    ],
    env: { AI_CACHE_EMBED_PROVIDER: "anthropic" },
    log: createLogger((line) => logs.push(line)),
  };
  return { repo, cache, space, calls, events, logs, deps };
}
it("registers the fifteen-minute timer and normalises before batching per provider, once", async () => {
  const r = rig();
  expect(SCHEDULE).toBe("0 */15 * * * *");
  await runEnrichment(r.deps);
  expect(r.repo.rows.find((r) => r.id === "space")).toMatchObject({
    name: "Example loaf",
    sourceName: "EXAMPLE LOAF 900G",
    verified: false,
  });
  expect(r.repo.rows.find((r) => r.id === "verified")).toMatchObject({
    verified: true,
    verifiedBy: "u1",
    portions: [{ label: "slice", carbs: 18 }],
  });
  expect(r.repo.rows.find((r) => r.id === "edited")?.name).toBe("My loaf");
  expect(r.repo.rows.find((r) => r.id === "off")?.sourceName).toBeUndefined();
  expect(r.repo.rows.find((r) => r.id === "off")?.embeddingModel).toBeUndefined();
  expect(
    r.repo.rows.filter((r) => ["ai", "typed"].includes(r.id)).map((r) => r.sourceName),
  ).toEqual([undefined, undefined]);
  expect(r.cache.calls.filter((c) => c.kind === "embed")).toHaveLength(1);
  expect(r.space.calls.filter((c) => c.kind === "embed")).toHaveLength(1);
  expect(r.cache.calls.at(-1)).toMatchObject({
    kind: "embed",
    request: { texts: ["Example loaf"] },
  });
  expect(r.events).toContainEqual({
    spaceId: "s1",
    type: "food.updated",
    payload: { foodId: "space" },
  });
  const count = r.cache.calls.length + r.space.calls.length;
  await runEnrichment(r.deps);
  expect(r.cache.calls.length + r.space.calls.length).toBe(count);
  expect(r.calls.rows.filter((r) => r.kind === "embed").map((r) => r.spaceId)).toEqual([
    null,
    "s1",
  ]);
  for (const line of r.logs)
    expect(Object.keys(JSON.parse(line) as object).sort()).toEqual([
      "code",
      "count",
      "level",
      "msg",
      "ts",
    ]);
  expect(r.logs.join()).not.toContain("LOAF");
});
it("marks failed or capped names finished and does not send AI-off rows", async () => {
  const r = rig();
  r.deps.env = {
    AI_CACHE_EMBED_PROVIDER: "anthropic",
    AI_DAILY_CAP: "0",
    AI_EMBED_DAILY_CAP: "0",
  } as typeof r.deps.env;
  r.cache.complete = () => Promise.reject(new Error("offline"));
  await runEnrichment(r.deps);
  expect(r.repo.rows.find((r) => r.id === "cache")).toMatchObject({
    name: "EXAMPLE LOAF 900G",
    sourceName: "EXAMPLE LOAF 900G",
  });
  expect(r.space.calls).toEqual([]);
  expect(r.repo.embeddings.has("off")).toBe(false);
});
it("has no configured embedding adapter: one code, no writes and no provider call", async () => {
  const r = rig();
  await runEnrichment({ ...r.deps, providers: {} });
  expect(r.logs).toHaveLength(1);
  expect(r.logs[0]).toContain('"code":"ai-not-configured"');
  expect(r.events).toEqual([]);
});
it("a changed embedding deployment revision is backfilled without renormalising", async () => {
  const r = rig();
  await runEnrichment(r.deps);
  const names = r.space.calls.filter((c) => c.kind === "complete").length;
  await runEnrichment({ ...r.deps, env: { ...r.deps.env, OLLAMA_MODEL_EMBED: "fixture-v2" } });
  expect(r.space.calls.filter((c) => c.kind === "complete")).toHaveLength(names);
  expect(r.space.calls.filter((c) => c.kind === "embed")).toHaveLength(2);
});

it("bounds work at 50 names and 100 embeddings, leaving room for each space when the cache is large", async () => {
  const r = rig();
  for (let n = 0; n < 160; n++)
    r.repo.rows.push(
      row(`cache-${String(n).padStart(3, "0")}`, null, { sourceRef: `remote-test:${n}` }),
    );
  await runEnrichment(r.deps);
  const nameCalls = [...r.cache.calls, ...r.space.calls].filter((c) => c.kind === "complete");
  const embedCalls = [...r.cache.calls, ...r.space.calls].filter((c) => c.kind === "embed");
  expect(nameCalls).toHaveLength(50);
  expect(embedCalls).toHaveLength(2);
  expect(embedCalls.reduce((n, call) => n + call.request.texts.length, 0)).toBeLessThanOrEqual(100);
  expect(r.repo.embeddings.has("space")).toBe(true);
});

it("a verified copy never prevents an unverified copy from being normalised", async () => {
  const r = rig();
  r.repo.rows.splice(
    0,
    r.repo.rows.length,
    row("a-verified", "s1", { verified: true, verifiedBy: "u1" }),
    row("b-unverified", "s2"),
  );
  r.deps.spaces.push({
    id: "s2",
    aiProvider: "ollama",
    aiEnabled: true,
    timezone: "UTC",
    locale: "en",
  });
  await runEnrichment(r.deps);
  expect(r.repo.rows.find((food) => food.id === "a-verified")).toMatchObject({
    name: "EXAMPLE LOAF 900G",
    verified: true,
    verifiedBy: "u1",
  });
  expect(r.repo.rows.find((food) => food.id === "b-unverified")).toMatchObject({
    name: "Example loaf",
    sourceName: "EXAMPLE LOAF 900G",
    verified: false,
  });
  expect(r.space.calls.filter((call) => call.kind === "complete")).toHaveLength(1);
});

it.each(["cache", "space"] as const)(
  "providerless %s rows cannot fill the normalisation limit ahead of a valid group",
  async (kind) => {
    const r = rig();
    r.deps.env.AI_CACHE_EMBED_PROVIDER = "azure-openai";
    r.deps.spaces.push({
      id: "missing",
      aiProvider: "azure-openai",
      aiEnabled: true,
      timezone: "UTC",
      locale: "en",
    });
    const unavailable = Array.from({ length: 60 }, (_, n) =>
      row(`a-${n}`, kind === "cache" ? null : "missing", {
        sourceRef: `remote-test:unavailable-${n}`,
      }),
    );
    r.repo.rows.splice(
      0,
      r.repo.rows.length,
      ...unavailable,
      row("z-valid", "s1", { sourceRef: "remote-test:valid" }),
    );
    await runEnrichment(r.deps);
    expect(r.repo.rows.find((food) => food.id === "z-valid")).toMatchObject({
      name: "Example loaf",
      sourceName: "EXAMPLE LOAF 900G",
    });
    expect(
      r.repo.rows
        .filter((food) => food.id.startsWith("a-"))
        .every((food) => food.sourceName == null),
    ).toBe(true);
    expect(r.cache.calls).toEqual([]);
  },
);

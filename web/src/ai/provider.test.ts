// @vitest-environment node
import { readFileSync } from "node:fs";
import { CappedAiProvider, type AiCallRow } from "@frejsi/shared/ai";
import { AiProviderId, NormalisedFood } from "@frejsi/shared/schemas/ai";
import { describe, expect, it } from "vitest";
import { aiForSpace, type AiProviderDeps } from "./provider";
import { actor } from "@/lib/foods/test-fixture.test";

const request = {
  role: "small" as const,
  system: "Name the food.",
  messages: [],
  outputSchema: NormalisedFood,
};
function rig() {
  const rows: AiCallRow[] = [];
  const space = { aiEnabled: true, aiProvider: "anthropic", timezone: "Europe/Copenhagen" };
  let exists = true;
  let now = new Date("2026-10-15T21:59:00Z");
  const aiCall = {
    count: ({
      where,
    }: {
      where: { spaceId: string | null; ts: { gte: Date; lt: Date }; kind: { in: string[] } };
    }) =>
      Promise.resolve(
        rows.filter(
          (r) =>
            r.spaceId === where.spaceId &&
            r.ts >= where.ts.gte &&
            r.ts < where.ts.lt &&
            where.kind.in.includes(r.kind),
        ).length,
      ),
    create: ({ data }: { data: Omit<AiCallRow, "id"> }) => {
      const row = { ...data, id: String(rows.length) };
      rows.push(row);
      return Promise.resolve({ id: row.id });
    },
    update: ({
      where,
      data,
    }: {
      where: { id: string };
      data: { model: string; ok: boolean; ms: number };
    }) => {
      const row = rows.find((r) => r.id === where.id);
      if (!row) throw new Error("missing reservation");
      Object.assign(row, data);
      return Promise.resolve({ id: row.id });
    },
  };
  const db = {
    space: { findUnique: () => Promise.resolve(exists ? space : null) },
    aiCall,
    $transaction: async <T>(run: (tx: { aiCall: typeof aiCall }) => Promise<T>) => run({ aiCall }),
  } as unknown as NonNullable<AiProviderDeps["db"]>;
  return {
    space,
    rows,
    remove: () => {
      exists = false;
    },
    setNow: (value: string) => {
      now = new Date(value);
    },
    deps: { db, env: { FAKE_AI_PROVIDER: "1" }, now: () => now } satisfies AiProviderDeps,
  };
}

describe("aiForSpace", () => {
  it("rejects disabled, missing and unconfigured spaces without recording a call", async () => {
    const r = rig();
    r.space.aiEnabled = false;
    await expect(aiForSpace("s1", actor, r.deps)).rejects.toMatchObject({
      status: 409,
      code: "ai-disabled",
    });
    r.space.aiEnabled = true;
    await expect(aiForSpace("s1", actor, { ...r.deps, env: {} })).rejects.toMatchObject({
      status: 503,
      code: "ai-not-configured",
    });
    r.space.aiProvider = "unknown";
    await expect(aiForSpace("s1", actor, r.deps)).rejects.toMatchObject({
      code: "ai-not-configured",
    });
    r.remove();
    await expect(aiForSpace("s1", actor, r.deps)).rejects.toMatchObject({ status: 404 });
    expect(r.rows).toEqual([]);
  });
  it("rejects viewers and non-members before any provider attempt", async () => {
    const r = rig();
    await expect(
      aiForSpace("s1", { ...actor, memberships: [{ spaceId: "s1", role: "viewer" }] }, r.deps),
    ).rejects.toMatchObject({ status: 403 });
    await expect(aiForSpace("other", actor, r.deps)).rejects.toMatchObject({ status: 404 });
    expect(r.rows).toEqual([]);
  });
  it.each(AiProviderId.options)("returns the counted offline provider for %s", async (id) => {
    const r = rig();
    r.space.aiProvider = id;
    const provider = await aiForSpace("s1", actor, r.deps);
    expect(provider).toBeInstanceOf(CappedAiProvider);
    expect(r.rows).toEqual([]);
    const result = await provider.complete(request);
    expect(result.kind).toBe("json");
    if (result.kind !== "json") throw new Error("Expected structured food");
    expect(NormalisedFood.parse(result.json).name).toBe("Example loaf");
    expect(r.rows).toEqual([
      expect.objectContaining({
        spaceId: "s1",
        userId: actor.userId,
        provider: "fake",
        model: "fixture",
        ok: true,
      }),
    ]);
    expect(Object.keys(r.rows[0] ?? {}).sort()).toEqual(
      ["id", "spaceId", "userId", "kind", "use", "provider", "model", "ok", "ms", "ts"].sort(),
    );
  });
  it("shares default caps across factory instances and resets at the space's midnight", async () => {
    const r = rig();
    const a = await aiForSpace("s1", actor, r.deps);
    const b = await aiForSpace("s1", actor, r.deps);
    for (let i = 0; i < 50; i++) await (i % 2 ? a : b).complete(request);
    await expect(b.complete(request)).rejects.toMatchObject({ code: "ai-cap-reached" });
    for (let i = 0; i < 500; i++) await a.embed({ texts: ["Example loaf"] });
    await expect(b.embed({ texts: ["Example loaf"] })).rejects.toMatchObject({
      code: "ai-cap-reached",
    });
    expect(r.rows.filter((row) => row.ok)).toHaveLength(550);
    r.setNow("2026-10-15T22:00:00Z");
    await expect(b.complete(request)).resolves.toMatchObject({ kind: "json" });
    await expect(b.embed({ texts: ["Example loaf"] })).resolves.toMatchObject({ model: "fixture" });
  });
  it("honours configured caps including zero and fails closed on malformed values", async () => {
    const r = rig();
    const env = { FAKE_AI_PROVIDER: "1", AI_DAILY_CAP: "1", AI_EMBED_DAILY_CAP: "0" };
    const provider = await aiForSpace("s1", actor, { ...r.deps, env });
    await provider.complete(request);
    await expect(provider.complete(request)).rejects.toMatchObject({ code: "ai-cap-reached" });
    await expect(provider.embed({ texts: ["Example loaf"] })).rejects.toMatchObject({
      code: "ai-cap-reached",
    });
    for (const key of ["AI_DAILY_CAP", "AI_EMBED_DAILY_CAP"])
      for (const value of ["-1", "1.5", "bad", "Infinity", "9007199254740992"])
        await expect(
          aiForSpace("s1", actor, { ...r.deps, env: { ...env, [key]: value } }),
        ).rejects.toMatchObject({ code: "ai-not-configured" });
    expect(r.rows).toHaveLength(3);
  });
});

it("declares only offline-safe AI environment defaults", () => {
  const source = readFileSync(new URL("../../../.env.example", import.meta.url), "utf8");
  const defaults = Object.fromEntries(
    source
      .split("\n")
      .filter((line) => /^\w+=/.test(line))
      .map((line) => {
        const at = line.indexOf("=");
        return [line.slice(0, at), line.slice(at + 1)];
      }),
  );
  expect(defaults).toMatchObject({
    AI_DAILY_CAP: "50",
    AI_EMBED_DAILY_CAP: "500",
    AI_EMBED_BACKFILL_DAILY_CAP: "2000",
    AI_CACHE_EMBED_PROVIDER: "",
    FAKE_AI_PROVIDER: "",
  });
});

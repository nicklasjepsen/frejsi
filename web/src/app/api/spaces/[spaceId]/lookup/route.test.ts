import type { SearchEmbed } from "@frejsi/shared/food/types";
import { FakeAiProvider } from "@frejsi/shared/ai/fake";
import { CappedAiProvider } from "@frejsi/shared/ai";
import { MemoryAiCallRepository } from "@frejsi/shared/ai/calls";
import { searchEmbed } from "@frejsi/shared/ai/search/embed";
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { Food, LookupResponse, HttpError } from "@frejsi/shared";
import { FakeFoodSource } from "@frejsi/shared/food/fake";
import { MemoryFoodRepository } from "@frejsi/shared/food/memory";
import { MemoryPhotoStore } from "@frejsi/shared/photos/memory";
import { FakeLiveDb, captureLog, liveRequest, spaceContext } from "@/lib/live/test-support";
import { configureLookup } from "./server";
import { GET } from "./route";

const at = new Date();
const food = (id: string, verified: boolean) =>
  Food.parse({
    id,
    spaceId: "s1",
    name: "Fictional toast",
    nameSearch: "fictional toast",
    sourceRef: `family:${id}`,
    origin: "family",
    verified,
    carbsPer100g: 40,
    barcode: "2000000000008",
    createdAt: at.toISOString(),
    updatedAt: at.toISOString(),
    photoKey: `spaces/s1/foods/${id}/photo`,
  });
function setup(simpleMode = false, embed: SearchEmbed | null = null) {
  const auth = new FakeLiveDb(() => at);
  auth.addSpace("s1");
  auth.addMember("carer", "s1", "carer");
  auth.addMember("viewer", "s1", "viewer");
  auth.addMember("outsider", "other", "carer");
  const db = auth.db;
  const original = db.session.findUnique.bind(db.session);
  db.session.findUnique = vi.fn(async (args: { where: { id: string } }) => {
    const row = await original({ ...args, include: { user: { include: { memberships: true } } } });
    return row ? { ...row, user: { ...row.user, simpleMode, locale: "en" } } : null;
  }) as unknown as typeof original;
  const repo = new MemoryFoodRepository([food("f1", true), food("f2", false)]);
  const source = new FakeFoodSource({ id: "fake-remote", kind: "remote" });
  configureLookup({
    sessionDb: db,
    repo,
    sources: [source],
    photos: new MemoryPhotoStore(),
    searchEmbedding: () => Promise.resolve(embed),
  });
  return { repo, source };
}
const get = (query: Record<string, string>, user = "carer") =>
  GET(liveRequest("s1", "lookup", `sess-${user}`, query), spaceContext("s1"));
afterEach(() => {
  configureLookup({});
  vi.restoreAllMocks();
});

describe("lookup route", () => {
  it("returns the shared response, library photos, remote skip status and locale", async () => {
    const { source } = setup();
    const response = await get({ q: "toast", remote: "false" });
    expect(response.status).toBe(200);
    const body = LookupResponse.parse(await response.json());
    expect(body.results).toHaveLength(2);
    expect(body.results[0]?.food).toHaveProperty(
      "photo.thumbUrl",
      expect.stringContaining("thumb.jpg"),
    );
    expect(body.sources).toEqual({ "fake-remote": "skipped", semantic: "skipped" });
    await get({ q: "toast", remote: "true" });
    expect(source.calls).toEqual([{ method: "search", q: "toast", locale: "en" }]);
    expect((await get({ barcode: "2000000000008" })).status).toBe(200);
  });
  it("enforces simpleMode from the session and rejects viewers before querying", async () => {
    const { source } = setup(true);
    const body = LookupResponse.parse(await (await get({ q: "toast" })).json());
    expect(body.results.map((r) => ("id" in r.food ? r.food.id : "candidate"))).toEqual(["f1"]);
    expect(source.calls).toHaveLength(0);
    expect((await get({ q: "toast" }, "viewer")).status).toBe(403);
  });
  it("maps invalid input and repository failure and logs no food, query or barcode", async () => {
    const { repo } = setup();
    const logs = captureLog();
    expect((await get({ barcode: "2000000000000" })).status).toBe(400);
    expect(await (await get({ barcode: "2000000000000" })).json()).toHaveProperty(
      "error.code",
      "barcode-invalid",
    );
    expect((await get({ q: "toast", remote: "no" })).status).toBe(400);
    await get({ q: "toast" });
    vi.spyOn(repo, "searchLibrary").mockRejectedValue(new Error("toast 2000000000008"));
    const failed = await get({ q: "toast" });
    expect(failed.status).toBe(503);
    expect(await failed.json()).toHaveProperty("error.code", "lookup-unavailable");
    expect(logs.lines.length).toBeGreaterThan(0);
    expect(logs.all()).not.toMatch(/toast|200000000000|Fictional/);
    expect(repo.writes).toHaveLength(0);
  });
});

it("semantic lookup hydrates photos and rejects other roles before any capped call", async () => {
  const vector = [1, ...Array<number>(1023).fill(0)];
  const fake = new FakeAiProvider([{ vectors: [vector], model: "fixture" }]);
  const provider = new CappedAiProvider(fake, new MemoryAiCallRepository(), {
    spaceId: "s1",
    timezone: "UTC",
  });
  const { repo } = setup(false, searchEmbed(provider, ""));
  await repo.setEmbeddings([{ id: "f1", vector, model: "fixture" }]);
  expect((await get({ q: "brown bread" }, "viewer")).status).toBe(403);
  expect((await get({ q: "brown bread" }, "outsider")).status).toBe(404);
  expect(fake.calls).toEqual([]);
  const response = await get({ q: "brown bread", remote: "true" });
  expect(response.status).toBe(200);
  const body = LookupResponse.parse(await response.json());
  expect(body.sources.semantic).toBe("ok");
  expect(body.results[0]?.food).toHaveProperty(
    "photo.thumbUrl",
    expect.stringContaining("thumb.jpg"),
  );
  expect(fake.calls).toHaveLength(1);
});
it.each(["ai-disabled", "ai-not-configured", "ai-cap-reached"] as const)(
  "%s search falls back to keywords",
  async (code) => {
    const fake = new FakeAiProvider([new HttpError(503, code)]);
    const provider = new CappedAiProvider(fake, new MemoryAiCallRepository(), {
      spaceId: "s1",
      timezone: "UTC",
    });
    setup(false, searchEmbed(provider, ""));
    const response = await get({ q: "toast", remote: "true" });
    expect(response.status).toBe(200);
    const body = LookupResponse.parse(await response.json());
    expect(body.results).toHaveLength(2);
    expect(body.sources.semantic).toBe("skipped");
    expect(fake.calls).toEqual([{ kind: "embed", request: { texts: ["toast"], use: "search" } }]);
  },
);

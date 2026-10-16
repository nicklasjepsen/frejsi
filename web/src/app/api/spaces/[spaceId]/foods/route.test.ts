// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { FakeAiProvider } from "@frejsi/shared/ai/fake";
import { CappedAiProvider } from "@frejsi/shared/ai";
import { MemoryAiCallRepository } from "@frejsi/shared/ai/calls";
import { MemoryFoodRepository } from "@frejsi/shared/food/memory";
import { Food } from "@frejsi/shared/schemas/food";
import { searchEmbed } from "@frejsi/shared/ai/search/embed";
import { configureFoods } from "@/lib/foods";
import { foodTestRig, T0 } from "@/lib/foods/test-fixture.test";
import { FakeLiveDb, liveRequest, spaceContext } from "@/lib/live/test-support";
import { GET } from "./route";
const vector = [1, ...Array<number>(1023).fill(0)];
afterEach(() => {
  configureFoods({});
  vi.restoreAllMocks();
});
it("Enter semantic mode finds the brown bread through a vector for owner/carer; typing is keyword", async () => {
  const rig = foodTestRig();
  const auth = new FakeLiveDb(() => T0);
  auth.addSpace("s1");
  auth.addMember("absent", "s2", "carer");
  for (const role of ["owner", "carer", "viewer"] as const) auth.addMember(role, "s1", role);
  rig.seed({ id: "rye", name: "Rugbrød", nameSearch: "rugbrod" });
  const repo = new MemoryFoodRepository([
    Food.parse({
      id: "rye",
      spaceId: "s1",
      name: "Rugbrød",
      nameSearch: "rugbrod",
      origin: "family",
      sourceRef: "family:rye",
      carbsPer100g: 40,
      portions: [],
      createdAt: T0.toISOString(),
      updatedAt: T0.toISOString(),
    }),
  ]);
  await repo.setEmbeddings([{ id: "rye", vector, model: "fixture" }]);
  const fake = new FakeAiProvider([
    { vectors: [vector], model: "fixture" },
    { vectors: [vector], model: "fixture" },
  ]);
  const capped = new CappedAiProvider(fake, new MemoryAiCallRepository(), {
    spaceId: "s1",
    timezone: "UTC",
  });
  configureFoods({
    ...rig.deps,
    repo,
    sessionDb: auth.db,
    searchEmbedding: () => Promise.resolve(searchEmbed(capped, "")),
  });
  const get = (role: string, mode = "keyword") =>
    GET(
      liveRequest("s1", "foods", `sess-${role}`, { q: "det brune brød", mode }),
      spaceContext("s1"),
    );
  expect(await (await get("owner")).json()).toHaveProperty("foods", []);
  expect(fake.calls).toEqual([]);
  for (const role of ["owner", "carer"]) {
    const response = await get(role, "semantic");
    expect(response.status).toBe(200);
    expect(await response.json()).toHaveProperty("foods.0.name", "Rugbrød");
  }
  expect((await get("viewer", "semantic")).status).toBe(403);
  expect((await get("absent", "semantic")).status).toBe(404);
  expect(fake.calls).toHaveLength(2);
  expect((await get("owner", "invalid")).status).toBe(400);
});

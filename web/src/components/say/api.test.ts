import { afterEach, expect, it, vi } from "vitest";
import { fetchFake } from "../meal/test-support";
import { aiUsage } from "./api";
afterEach(() => {
  vi.unstubAllGlobals();
});
it("uses the owned availability adapter when the other lane's usage endpoint is absent", async () => {
  const fake = fetchFake().on("GET /api/spaces/s1/parse", { enabled: true });
  fake.install();
  expect(await aiUsage("s1")).toEqual({ enabled: true });
  expect(fake.calls.map((call) => call.path)).toEqual([
    "/api/spaces/s1/ai",
    "/api/spaces/s1/parse",
  ]);
});
it("never falls back for an authorization failure", async () => {
  const fake = fetchFake()
    .on("GET /api/spaces/s1/ai", { error: { code: "forbidden" } }, 403)
    .on("GET /api/spaces/s1/parse", { enabled: true });
  fake.install();
  await expect(aiUsage("s1")).rejects.toThrow();
  expect(fake.calls.map((call) => call.path)).toEqual(["/api/spaces/s1/ai"]);
});

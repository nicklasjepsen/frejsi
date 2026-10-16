import { expect, it } from "vitest";
import { CappedAiProvider } from "../capped";
import { MemoryAiCallRepository } from "../calls";
import { FakeAiProvider } from "../fake";
import { assertNoDosing } from "../guard";
import { normaliseFoodName } from "./normalise";
import { NORMALISE_FOOD_PROMPT } from "./prompt";
import { embeddingIdentity, embeddingRevision } from "./model";
it("normalisation is a guarded, capped small call in the supplied locale", async () => {
  const fake = new FakeAiProvider([
    { kind: "json", model: "fixture", json: { name: "Example loaf", portions: [] } },
  ]);
  const calls = new MemoryAiCallRepository();
  const provider = new CappedAiProvider(fake, calls, {
    spaceId: "s1",
    timezone: "UTC",
    dailyCap: 1,
  });
  expect(await normaliseFoodName(provider, "EXAMPLE LOAF 900G", "en")).toEqual({
    name: "Example loaf",
    portions: [],
  });
  expect(fake.calls[0]).toMatchObject({
    kind: "complete",
    request: {
      role: "small",
      use: "normalise",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: JSON.stringify({ name: "EXAMPLE LOAF 900G", locale: "en" }) },
          ],
        },
      ],
    },
  });
  expect(await normaliseFoodName(provider, "Other loaf", "da")).toBeNull();
  expect(fake.calls).toHaveLength(1);
  expect(calls.rows.map((r) => r.ok)).toEqual([true, false]);
  expect(() => {
    assertNoDosing(NORMALISE_FOOD_PROMPT, "prompt");
  }).not.toThrow();
});
it("web/poller share a release identity, different providers never share vectors, model changes backfill", () => {
  const web = embeddingRevision("ollama", {
    NEXT_PUBLIC_APP_VERSION: "v0.4.0",
    OLLAMA_MODEL_EMBED: "fixture",
  });
  const poller = embeddingRevision("ollama", {
    APP_VERSION: "v0.4.0",
    OLLAMA_MODEL_EMBED: "fixture",
  });
  expect(web).toBe(poller);
  expect(embeddingRevision("anthropic", { APP_VERSION: "v0.4.0" })).not.toBe(poller);
  expect(
    embeddingRevision("ollama", { APP_VERSION: "v0.4.0", OLLAMA_MODEL_EMBED: "other" }),
  ).not.toBe(poller);
  expect(
    embeddingRevision("ollama", { APP_VERSION: "v0.4.1", OLLAMA_MODEL_EMBED: "fixture" }),
  ).not.toBe(poller);
  expect(embeddingIdentity(web, "fixture")).toContain("fixture");
  expect(embeddingIdentity(web, "x".repeat(100)).length).toBeLessThanOrEqual(80);
});

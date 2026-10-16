import { describe, expect, it } from "vitest";
import { z } from "zod";
import { CappedAiProvider } from "./capped";
import { MemoryAiCallRepository } from "./calls";
import { FakeAiProvider } from "./fake";
import { assertNoDosing } from "./guard";
import { aiProviders } from "./registry";
import { runToolLoop } from "./tool-loop";
import { PhotoEstimate } from "../schemas/ai";
import { HttpError } from "../schemas/api";
import type { CompleteRequest, CompleteResult } from "./types";

const outputSchema = z.strictObject({ text: z.string() });
const req: CompleteRequest = {
  role: "everyday",
  system: "Describe the meal.",
  messages: [{ role: "user", content: [{ type: "text", text: "Example meal" }] }],
  outputSchema,
};
const answer: CompleteResult = {
  kind: "json",
  json: { text: "The meal is ready." },
  model: "fixture",
};
function setup(
  script: (CompleteResult | Error | { vectors: number[][]; model: string })[] = [answer],
  options = {},
) {
  const inner = new FakeAiProvider(script);
  const calls = new MemoryAiCallRepository();
  const provider = new CappedAiProvider(inner, calls, {
    spaceId: "s1",
    userId: "u1",
    timezone: "Europe/Copenhagen",
    now: () => new Date("2026-10-15T10:00:00Z"),
    use: "parse",
    ...options,
  });
  return { provider, calls, inner };
}
const code = (value: string): unknown => expect.objectContaining({ code: value });

describe("CappedAiProvider", () => {
  it("validates JSON, records metadata only, and preserves the request and capabilities", async () => {
    const { provider, calls, inner } = setup();
    expect(await provider.complete(req)).toEqual(answer);
    expect(inner.calls).toEqual([{ kind: "complete", request: req }]);
    expect(provider.capabilities()).toEqual({ complete: true, vision: true, embed: true });
    expect(calls.rows).toEqual([
      expect.objectContaining({
        spaceId: "s1",
        userId: "u1",
        kind: "complete",
        use: "parse",
        provider: "fake",
        model: "fixture",
        ok: true,
        ms: expect.any(Number) as unknown,
      }),
    ]);
    expect(Object.keys(calls.rows[0] ?? {}).sort()).toEqual(
      ["id", "spaceId", "userId", "kind", "use", "provider", "model", "ok", "ms", "ts"].sort(),
    );
  });
  it("refuses the 51st combined complete/vision before the inner provider and records every attempt", async () => {
    const { provider, calls, inner } = setup(Array.from({ length: 50 }, () => answer));
    const vision = {
      role: "everyday" as const,
      system: req.system,
      image: { mediaType: "image/jpeg" as const, base64: "/9j/2Q==" },
      prompt: "Example plate",
      outputSchema,
    };
    for (let i = 0; i < 25; i++) {
      await provider.complete(req);
      await provider.vision(vision);
    }
    await expect(provider.complete(req)).rejects.toEqual(code("ai-cap-reached"));
    expect(inner.calls).toHaveLength(50);
    expect(calls.rows).toHaveLength(51);
    expect(calls.rows.at(-1)?.ok).toBe(false);
  });
  it("counts embeddings separately and refuses the 501st", async () => {
    const vector = { vectors: [Array<number>(1024).fill(0)], model: "fixture" };
    const { provider, calls, inner } = setup([
      ...Array.from({ length: 500 }, () => vector),
      answer,
    ]);
    for (let i = 0; i < 500; i++) await provider.embed({ texts: ["Example loaf"] });
    await expect(provider.embed({ texts: ["Example loaf"] })).rejects.toEqual(
      code("ai-cap-reached"),
    );
    expect(await provider.complete(req)).toEqual(answer);
    expect(inner.calls).toHaveLength(501);
    expect(calls.rows).toHaveLength(502);
  });
  it("reserves slots atomically across wrappers sharing a repository", async () => {
    const { provider, calls, inner } = setup(
      Array.from({ length: 20 }, () => answer),
      { dailyCap: 5 },
    );
    const second = new CappedAiProvider(inner, calls, {
      spaceId: "s1",
      userId: "u2",
      timezone: "Europe/Copenhagen",
      dailyCap: 5,
      now: () => new Date("2026-10-15T10:00:00Z"),
      use: "parse",
    });
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) => (i % 2 ? provider : second).complete(req)),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(5);
    expect(inner.calls).toHaveLength(5);
    expect(calls.rows).toHaveLength(20);
  });
  it.each([
    ["Europe/Copenhagen", "s1", "2026-10-15T21:59:59Z", "2026-10-15T22:00:00Z"],
    ["America/New_York", "s1", "2026-10-16T03:59:59Z", "2026-10-16T04:00:00Z"],
    ["Europe/Copenhagen", null, "2026-10-15T23:59:59Z", "2026-10-16T00:00:00Z"],
    ["Europe/Copenhagen", "s1", "2026-10-25T22:59:59Z", "2026-10-25T23:00:00Z"],
  ])("rolls over at %s local midnight (%s)", async (timezone, spaceId, before, after) => {
    let now = new Date(before);
    const { provider, inner } = setup([answer, answer], {
      timezone,
      spaceId,
      now: () => now,
      dailyCap: 1,
    });
    await provider.complete(req);
    await expect(provider.complete(req)).rejects.toEqual(code("ai-cap-reached"));
    now = new Date(after);
    expect(await provider.complete(req)).toEqual(answer);
    expect(inner.calls).toHaveLength(2);
  });
  it.each([
    [{ kind: "refusal", model: "fixture" }, "ai-unavailable"],
    [new Error("private vendor response"), "ai-unavailable"],
    [{ kind: "json", json: { wrong: "shape" }, model: "fixture" }, "ai-rejected"],
    [{ kind: "json", json: { text: "tag to enheder insulin" }, model: "fixture" }, "ai-rejected"],
  ] as const)("records failures and returns a safe code", async (result, expected) => {
    const { provider, calls } = setup([result]);
    await expect(provider.complete(req)).rejects.toEqual(code(expected));
    expect(calls.rows).toHaveLength(1);
    expect(calls.rows[0]?.ok).toBe(false);
    expect(JSON.stringify(calls.rows)).not.toMatch(/private|enheder|wrong/);
  });
  it("guards every nested output string, including a dish name and names in arrays", async () => {
    const bad = {
      items: [{ name: "Example pasta", carbs: 30, confidence: "high", approx: true }],
      dishName: "Pasta · tag 2 enheder insulin",
      totalCarbs: 30,
      approx: true,
    };
    const { provider } = setup([{ kind: "json", json: bad, model: "fixture" }]);
    await expect(provider.complete({ ...req, outputSchema: PhotoEstimate })).rejects.toEqual(
      code("ai-rejected"),
    );
    const nested = setup([
      { kind: "json", json: { items: [{ name: "ratio" }] }, model: "fixture" },
    ]);
    await expect(
      nested.provider.complete({
        ...req,
        outputSchema: z.strictObject({ items: z.array(z.strictObject({ name: z.string() })) }),
      }),
    ).rejects.toEqual(code("ai-rejected"));
  });
  it("rejects malformed embeddings", async () => {
    const { provider, calls } = setup([{ vectors: [[1, 2]], model: "fixture" }]);
    await expect(provider.embed({ texts: ["Example"] })).rejects.toEqual(code("ai-rejected"));
    expect(calls.rows[0]?.ok).toBe(false);
  });
});

describe("string guard", () => {
  it.each([
    "tag to enheder insulin",
    "bolus 10–15 minutter før",
    "ratio",
    "Bolus 12:30",
    "never calculates insulin",
  ])("rejects %s without the UI allow-list", (text) => {
    expect(() => {
      assertNoDosing(text, "test");
    }).toThrow(HttpError);
    try {
      assertNoDosing(text, "test");
    } catch (error) {
      expect(error).toEqual(code("ai-rejected"));
      expect((error as Error).message).not.toContain(text);
    }
  });
  it("passes a numerical observation", () => {
    expect(() => {
      assertNoDosing("toppen omkring 9–10 cirka en time efter", "test");
    }).not.toThrow();
  });
});

describe("fake, registry and tool loop", () => {
  it("leaves providers off without configuration and maps every id to a fake when explicitly enabled", () => {
    expect(aiProviders({})).toEqual({});
    expect(Object.keys(aiProviders({ FAKE_AI_PROVIDER: "0" }))).toEqual([]);
    const registry = aiProviders({ FAKE_AI_PROVIDER: "1" });
    for (const id of ["anthropic", "azure-openai", "ollama"] as const)
      expect(registry[id]).toBeInstanceOf(FakeAiProvider);
  });
  it("executes a batch in parallel and appends all results in one message before JSON", async () => {
    const fake = new FakeAiProvider([
      {
        kind: "tool-calls",
        model: "fixture",
        calls: [
          { id: "a", name: "lookup", input: { q: "loaf" } },
          { id: "b", name: "lookup", input: { q: "pasta" } },
        ],
      },
      answer,
    ]);
    let release: (() => void) | undefined;
    const bothStarted = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started: unknown[] = [];
    const result = await runToolLoop(
      fake,
      req,
      {
        lookup: async (input) => {
          started.push(input);
          if (started.length === 2) release?.();
          await bothStarted;
          return input;
        },
      },
      { maxCalls: 8 },
    );
    expect(result).toEqual(answer);
    expect(started).toEqual([{ q: "loaf" }, { q: "pasta" }]);
    const call = fake.calls[1];
    if (call?.kind !== "complete") throw new Error("Expected completion");
    expect(call.request.messages.slice(-2)).toEqual([
      {
        role: "assistant",
        content: [
          { type: "tool-call", id: "a", name: "lookup", input: { q: "loaf" } },
          { type: "tool-call", id: "b", name: "lookup", input: { q: "pasta" } },
        ],
      },
      {
        role: "user",
        content: [
          { type: "tool-result", toolCallId: "a", result: { q: "loaf" } },
          { type: "tool-result", toolCallId: "b", result: { q: "pasta" } },
        ],
      },
    ]);
    expect(fake.calls[0]).toEqual({ kind: "complete", request: req });
  });
  it("refuses a ninth tool call before executing any part of the over-limit batch", async () => {
    const calls = Array.from({ length: 9 }, (_, index) => ({
      id: String(index),
      name: "lookup",
      input: { q: "Example" },
    }));
    const fake = new FakeAiProvider([
      { kind: "tool-calls", calls: calls.slice(0, 8), model: "fixture" },
      { kind: "tool-calls", calls: calls.slice(8), model: "fixture" },
    ]);
    const executed: unknown[] = [];
    await expect(
      runToolLoop(
        fake,
        req,
        {
          lookup: (input) => {
            executed.push(input);
            return Promise.resolve([]);
          },
        },
        { maxCalls: 8 },
      ),
    ).rejects.toEqual(code("ai-rejected"));
    expect(executed).toHaveLength(8);
  });
  it("refuses unknown tools, empty batches and non-JSON final output", async () => {
    for (const result of [
      { kind: "tool-calls", calls: [{ id: "a", name: "unknown", input: {} }], model: "fixture" },
      { kind: "tool-calls", calls: [], model: "fixture" },
      { kind: "text", text: "no JSON", model: "fixture" },
    ] as CompleteResult[]) {
      await expect(runToolLoop(new FakeAiProvider([result]), req, {})).rejects.toEqual(
        code("ai-rejected"),
      );
    }
  });
});

it("rejects generated numeric unit instructions and advice verbs without relying on a named substance", () => {
  for (const text of [
    "Give 2 units before eating",
    "Giv 2 enheder",
    "2.5 units",
    "twenty units",
    "femogtyve enheder",
    "to enheder",
    "2U",
    "Take two before lunch",
    "Tag to før frokost",
    "You should change it next time",
  ]) {
    expect(() => {
      assertNoDosing(text, "test");
    }).toThrow(expect.objectContaining({ code: "ai-rejected" }));
  }
});

it("provides repeatable usable fake-mode results for every output contract and embeddings", async () => {
  const { AiProviderId, ParsedMeal, PhotoEstimate, NormalisedFood, MealInsight, WeekInsight } =
    await import("../schemas/ai");
  const registry = aiProviders({ FAKE_AI_PROVIDER: "1" });
  for (const id of AiProviderId.options) {
    const fake = registry[id];
    if (!fake) throw new Error("Missing fake");
    for (const schema of [ParsedMeal, PhotoEstimate, NormalisedFood, MealInsight, WeekInsight]) {
      for (let i = 0; i < 2; i++) {
        const result = await fake.complete({ ...req, outputSchema: schema });
        expect(result.kind).toBe("json");
        if (result.kind === "json") expect(schema.safeParse(result.json).success).toBe(true);
      }
    }
    const image = await fake.vision({
      role: "everyday",
      system: "Describe the plate.",
      image: { mediaType: "image/jpeg", base64: "/9j/2Q==" },
      prompt: "Example plate",
      outputSchema: PhotoEstimate,
    });
    expect(image.kind).toBe("json");
    const embedded = await fake.embed({ texts: ["Example loaf", "Example pasta"] });
    expect(embedded.vectors).toHaveLength(2);
    for (const vector of embedded.vectors) {
      expect(vector).toHaveLength(1024);
      expect(vector.every(Number.isFinite)).toBe(true);
    }
  }
});

it("allows scripted fake-mode responses to be injected through the registry", async () => {
  const fake = aiProviders({ FAKE_AI_PROVIDER: "1" }, { fakeScript: [answer] }).anthropic;
  if (!fake) throw new Error("Missing fake");
  expect(await fake.complete(req)).toEqual(answer);
  await expect(fake.complete(req)).rejects.toEqual(code("ai-unavailable"));
});

it("returns safe tool failures alongside successful results so the model can finish", async () => {
  const fake = new FakeAiProvider([
    {
      kind: "tool-calls",
      model: "fixture",
      calls: [
        { id: "a", name: "lookup", input: "loaf" },
        { id: "b", name: "lookup", input: "pasta" },
      ],
    },
    answer,
  ]);
  expect(
    await runToolLoop(fake, req, {
      lookup: (input) =>
        input === "loaf"
          ? Promise.reject(new Error("private repository details"))
          : Promise.resolve({ name: "Example pasta" }),
    }),
  ).toEqual(answer);
  const call = fake.calls[1];
  if (call?.kind !== "complete") throw new Error("Expected completion");
  expect(call.request.messages.at(-1)).toEqual({
    role: "user",
    content: [
      { type: "tool-result", toolCallId: "a", result: { error: { code: "tool-unavailable" } } },
      { type: "tool-result", toolCallId: "b", result: { name: "Example pasta" } },
    ],
  });
  expect(JSON.stringify(call.request.messages)).not.toContain("private");
});

it.each(["Inject five U before eating", "five U", "fem E", "twenty-five u", "femogtyve e"])(
  "rejects generated spelled quantities with abbreviations: %s",
  async (text) => {
    const { provider, calls } = setup([{ kind: "json", json: { text }, model: "fixture" }]);
    await expect(provider.complete(req)).rejects.toEqual(code("ai-rejected"));
    expect(calls.rows[0]?.ok).toBe(false);
  },
);

it.each([
  "Inject five-U before eating",
  "Inject five (U) before eating",
  "five-U",
  "five (U)",
  "fem—E",
  "fem [E]",
  "five + U",
  "five Ｕ",
  "Inject a few before eating",
  "Injicer før måltidet",
])("rejects punctuated abbreviations and injection directives: %s", async (text) => {
  const { provider, calls } = setup([{ kind: "json", json: { text }, model: "fixture" }]);
  await expect(provider.complete(req)).rejects.toEqual(code("ai-rejected"));
  expect(calls.rows[0]?.ok).toBe(false);
});

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createLogger } from "../../log";
import { OllamaProvider } from "./provider";
import { fixture, outputSchema, request, tools, transport } from "../anthropic/test-helpers";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Unexpected socket");
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it.each([
  ["small", "tiny", 20_000],
  ["everyday", "daily", 30_000],
  ["insight", "weekly", 120_000],
] as const)("completes %s through its configured model and deadline", async (role, model, ms) => {
  const timeout = vi.spyOn(AbortSignal, "timeout");
  const t = transport(fixture("ollama", "complete-json"));
  expect(
    await new OllamaProvider({
      url: "http://127.0.0.1:11434",
      models: { small: "tiny", everyday: "daily", insight: "weekly", embed: "vectors" },
      fetch: t.fetch,
    }).complete({ ...request, role }),
  ).toMatchObject({ kind: "json", json: { name: "Apple" } });
  expect(timeout).toHaveBeenCalledWith(ms);
  expect(t.calls[0]?.signal).toBeInstanceOf(AbortSignal);
  expect(t.calls[0]?.body).toMatchObject({ model, stream: false });
  expect(t.calls[0]?.url).toBe("http://127.0.0.1:11434/api/chat");
  expect(t.calls[0]?.body.format).toMatchObject({
    type: "object",
    properties: { name: { type: "string" } },
  });
  expect(globalThis.fetch).not.toHaveBeenCalled();
});
it("parses tool calls and sends tool definitions", async () => {
  const t = transport(fixture("ollama", "complete-tool-call"));
  expect(
    await new OllamaProvider({
      url: "http://127.0.0.1:11434",
      models: { small: "tiny", everyday: "daily", insight: "weekly", embed: "vectors" },
      fetch: t.fetch,
    }).complete({ ...request, tools }),
  ).toMatchObject({ kind: "tool-calls", calls: [{ name: "lookup", input: { query: "apple" } }] });
  expect(t.calls[0]?.body.tools).toMatchObject([
    { type: "function", function: { name: "lookup", parameters: { type: "object" } } },
  ]);
});
it("serializes a complete tool loop transcript", async () => {
  const t = transport(fixture("ollama", "complete-json"));
  await new OllamaProvider({
    url: "http://127.0.0.1:11434",
    models: { small: "tiny", everyday: "daily", insight: "weekly", embed: "vectors" },
    fetch: t.fetch,
  }).complete({
    ...request,
    tools,
    messages: [
      {
        role: "assistant",
        content: [{ type: "tool-call", id: "call_1", name: "lookup", input: { query: "apple" } }],
      },
      {
        role: "user",
        content: [{ type: "tool-result", toolCallId: "call_1", result: { name: "Apple" } }],
      },
    ],
  });
  expect(t.calls[0]?.body.messages).toMatchObject([
    {},
    {
      role: "assistant",
      tool_calls: [{ function: { name: "lookup", arguments: { query: "apple" } } }],
    },
    { role: "tool", tool_name: "lookup", content: '{"name":"Apple"}' },
  ]);
});
it("sends the photo in the provider's image field", async () => {
  const t = transport(fixture("ollama", "vision"));
  expect(
    await new OllamaProvider({
      url: "http://127.0.0.1:11434",
      models: { small: "tiny", everyday: "daily", insight: "weekly", embed: "vectors" },
      fetch: t.fetch,
    }).vision({
      role: "everyday",
      system: request.system,
      image: { mediaType: "image/jpeg", base64: "ZmljdGlvbmFs" },
      prompt: "Describe food",
      outputSchema,
    }),
  ).toMatchObject({ kind: "json" });
  expect(t.calls[0]?.body.messages).toMatchObject([
    {},
    { role: "user", content: "Describe food", images: ["ZmljdGlvbmFs"] },
  ]);
});
it("returns refusal", async () => {
  const t = transport(fixture("ollama", "complete-refusal"));
  expect(
    await new OllamaProvider({
      url: "http://127.0.0.1:11434",
      models: { small: "tiny", everyday: "daily", insight: "weekly", embed: "vectors" },
      fetch: t.fetch,
    }).complete(request),
  ).toMatchObject({ kind: "refusal" });
});
it("embeds with a ten second deadline and enforces 1024 dimensions", async () => {
  const timeout = vi.spyOn(AbortSignal, "timeout");
  const t = transport(fixture("ollama", "embed"));
  expect(
    (
      await new OllamaProvider({
        url: "http://127.0.0.1:11434",
        models: { small: "tiny", everyday: "daily", insight: "weekly", embed: "vectors" },
        fetch: t.fetch,
      }).embed({ texts: ["Apple"] })
    ).vectors[0],
  ).toHaveLength(1024);
  expect(timeout).toHaveBeenCalledWith(10_000);
  expect(t.calls[0]?.body).toMatchObject({ model: "vectors", input: ["Apple"], dimensions: 1024 });
  const bad = transport(fixture("ollama", "embed-1536"));
  await expect(
    new OllamaProvider({
      url: "http://127.0.0.1:11434",
      models: { small: "tiny", everyday: "daily", insight: "weekly", embed: "vectors" },
      fetch: bad.fetch,
    }).embed({ texts: ["Apple"] }),
  ).rejects.toMatchObject({ code: "ai-unavailable" });
});
it.each([429, 500, 503])("maps HTTP %s and logs only the status", async (status) => {
  const lines: string[] = [];
  const t = transport({ error: "PRIVATE" }, status);
  await expect(
    new OllamaProvider({
      ...{
        url: "http://127.0.0.1:11434",
        models: { small: "tiny", everyday: "daily", insight: "weekly", embed: "vectors" },
        fetch: t.fetch,
      },
      logger: createLogger((line) => lines.push(line)),
    }).complete(request),
  ).rejects.toMatchObject({ code: "ai-unavailable" });
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain(String(status));
  expect(lines[0]).not.toContain("PRIVATE");
  expect(lines[0]).not.toContain("fictional");
});
it("maps a network failure without logging its message", async () => {
  const lines: string[] = [];
  const t = transport({});
  t.fetch.mockRejectedValue(new Error("PRIVATE"));
  await expect(
    new OllamaProvider({
      ...{
        url: "http://127.0.0.1:11434",
        models: { small: "tiny", everyday: "daily", insight: "weekly", embed: "vectors" },
        fetch: t.fetch,
      },
      logger: createLogger((line) => lines.push(line)),
    }).complete(request),
  ).rejects.toMatchObject({ code: "ai-unavailable" });
  expect(lines.join()).not.toContain("PRIVATE");
});

it("can send the existing parse contract with its transformed food fields", async () => {
  const { ParsedMeal } = await import("../../schemas/ai");
  const t = transport({ done: true, message: { content: '{"items":[],"unmatched":[]}' } });
  const result = await new OllamaProvider({
    url: "http://127.0.0.1:11434",
    models: { everyday: "daily" },
    fetch: t.fetch,
  }).complete({ ...request, outputSchema: ParsedMeal });
  expect(result).toMatchObject({ kind: "json", json: { items: [], unmatched: [] } });
  expect(t.calls).toHaveLength(1);
});

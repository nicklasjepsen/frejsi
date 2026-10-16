import Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createLogger } from "../../log";
import { AnthropicProvider } from "./provider";
import { fixture, outputSchema, request, tools, transport } from "./test-helpers";

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
  ["everyday", "claude-sonnet-5-5", 30_000],
  ["small", "claude-haiku-5-5", 20_000],
  ["insight", "claude-fable-5-1", 120_000],
] as const)("uses the %s model, structured output and deadline", async (role, model, timeout) => {
  const t = transport(fixture("anthropic", "complete-json"));
  const client = new Anthropic({ apiKey: "fictional", fetch: t.fetch, maxRetries: 0 });
  const create = vi.spyOn(client.messages, "create");
  const provider = new AnthropicProvider({ client });
  expect(await provider.complete({ ...request, role, effort: "medium" })).toEqual({
    kind: "json",
    json: { name: "Apple" },
    model,
  });
  expect(create.mock.calls[0]?.[1]).toMatchObject({ timeout, maxRetries: 0 });
  expect(t.calls[0]?.body).toMatchObject({
    model,
    max_tokens: 4096,
    output_config: {
      effort: "medium",
      format: { type: "json_schema", schema: { properties: { name: { type: "string" } } } },
    },
  });
  expect(t.calls[0]?.body).not.toHaveProperty("thinking");
  expect(t.calls[0]?.body.messages).toEqual(request.messages);
  expect(globalThis.fetch).not.toHaveBeenCalled();
});
it("uses low effort by default and strict automatic tools with parsed inputs", async () => {
  const t = transport(fixture("anthropic", "complete-tool-call"));
  const provider = new AnthropicProvider({ apiKey: "fictional", fetch: t.fetch });
  expect(await provider.complete({ ...request, tools })).toMatchObject({
    kind: "tool-calls",
    calls: [{ id: "call_1", name: "lookup", input: { query: "apple" } }],
  });
  expect(t.calls[0]?.body).toMatchObject({
    output_config: { effort: "low" },
    tool_choice: { type: "auto" },
    tools: [{ name: "lookup", strict: true, input_schema: { type: "object" } }],
  });
});
it("serializes tool calls and results in a second turn", async () => {
  const t = transport(fixture("anthropic", "complete-json"));
  await new AnthropicProvider({ apiKey: "fictional", fetch: t.fetch }).complete({
    ...request,
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
  expect(t.calls[0]?.body.messages).toEqual([
    {
      role: "assistant",
      content: [{ type: "tool_use", id: "call_1", name: "lookup", input: { query: "apple" } }],
    },
    {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "call_1", content: '{"name":"Apple"}' }],
    },
  ]);
});
it("returns refusal without another model call", async () => {
  const t = transport(fixture("anthropic", "complete-refusal"));
  expect(
    await new AnthropicProvider({ apiKey: "fictional", fetch: t.fetch }).complete(request),
  ).toMatchObject({ kind: "refusal" });
  expect(t.calls).toHaveLength(1);
});
it("sends image before text", async () => {
  const t = transport(fixture("anthropic", "vision"));
  expect(
    await new AnthropicProvider({ apiKey: "fictional", fetch: t.fetch }).vision({
      role: "everyday",
      system: request.system,
      image: { mediaType: "image/jpeg", base64: "ZmljdGlvbmFs" },
      prompt: "Describe food",
      outputSchema,
    }),
  ).toMatchObject({ kind: "json" });
  expect(t.calls[0]?.body.messages).toEqual([
    {
      role: "user",
      content: [
        {
          type: "image",
          source: { type: "base64", media_type: "image/jpeg", data: "ZmljdGlvbmFs" },
        },
        { type: "text", text: "Describe food" },
      ],
    },
  ]);
});
it.each([
  new Anthropic.RateLimitError(429, { error: { message: "PRIVATE" } }, "PRIVATE", new Headers()),
  new Anthropic.APIConnectionError({ message: "PRIVATE" }),
])("maps SDK errors and logs only their class", async (error) => {
  const lines: string[] = [];
  const client = new Anthropic({ apiKey: "fictional", fetch: transport({}).fetch, maxRetries: 0 });
  vi.spyOn(client.messages, "create").mockRejectedValue(error);
  await expect(
    new AnthropicProvider({ client, logger: createLogger((line) => lines.push(line)) }).complete(
      request,
    ),
  ).rejects.toMatchObject({ code: "ai-unavailable" });
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain(`"error":"${error.constructor.name}"`);
  expect(lines[0]).not.toContain("PRIVATE");
});
it("has no embeddings without Voyage and delegates with its key", async () => {
  const provider = new AnthropicProvider({ apiKey: "fictional", fetch: transport({}).fetch });
  expect(provider.capabilities().embed).toBe(false);
  await expect(provider.embed({ texts: ["Apple"] })).rejects.toMatchObject({
    code: "ai-not-configured",
  });
  const t = transport(fixture("voyage", "embed"));
  const configured = new AnthropicProvider({
    apiKey: "fictional",
    voyageApiKey: "fictional",
    fetch: t.fetch,
  });
  expect(configured.capabilities().embed).toBe(true);
  expect(await configured.embed({ texts: ["Apple"] })).toMatchObject({
    model: "voyage:voyage-3.5",
    vectors: [expect.arrayContaining([0.01])],
  });
  const bad = transport(fixture("voyage", "embed-1536"));
  await expect(
    new AnthropicProvider({
      apiKey: "fictional",
      voyageApiKey: "fictional",
      fetch: bad.fetch,
    }).embed({ texts: ["Apple"] }),
  ).rejects.toMatchObject({ code: "ai-unavailable" });
});

it("can send the existing parse contract with its transformed food fields", async () => {
  const { ParsedMeal } = await import("../../schemas/ai");
  const t = transport({
    id: "fictional",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5-5",
    stop_reason: "end_turn",
    content: [{ type: "text", text: '{"items":[],"unmatched":[]}' }],
    usage: { input_tokens: 1, output_tokens: 1 },
  });
  const result = await new AnthropicProvider({ apiKey: "fictional", fetch: t.fetch }).complete({
    ...request,
    outputSchema: ParsedMeal,
  });
  expect(result).toMatchObject({ kind: "json", json: { items: [], unmatched: [] } });
  expect(t.calls).toHaveLength(1);
});

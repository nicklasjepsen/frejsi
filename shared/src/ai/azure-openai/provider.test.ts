import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createLogger } from "../../log";
import { AzureOpenAiProvider } from "./provider";
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
  const t = transport(fixture("azure-openai", "complete-json"));
  expect(
    await new AzureOpenAiProvider({
      endpoint: "https://fictional.openai.azure.com",
      apiKey: "fictional",
      deployments: { small: "tiny", everyday: "daily", insight: "weekly", embed: "vectors" },
      fetch: t.fetch,
    }).complete({ ...request, role }),
  ).toMatchObject({ kind: "json", json: { name: "Apple" } });
  expect(timeout).toHaveBeenCalledWith(ms);
  expect(t.calls[0]?.signal).toBeInstanceOf(AbortSignal);
  expect(t.calls[0]?.url).toContain(
    `/deployments/${model}/chat/completions?api-version=2024-10-21`,
  );
  expect(t.calls[0]?.body.response_format).toMatchObject({
    type: "json_schema",
    json_schema: { strict: true, schema: { type: "object" } },
  });
  expect(globalThis.fetch).not.toHaveBeenCalled();
});
it("parses tool calls and sends tool definitions", async () => {
  const t = transport(fixture("azure-openai", "complete-tool-call"));
  expect(
    await new AzureOpenAiProvider({
      endpoint: "https://fictional.openai.azure.com",
      apiKey: "fictional",
      deployments: { small: "tiny", everyday: "daily", insight: "weekly", embed: "vectors" },
      fetch: t.fetch,
    }).complete({ ...request, tools }),
  ).toMatchObject({ kind: "tool-calls", calls: [{ name: "lookup", input: { query: "apple" } }] });
  expect(t.calls[0]?.body.tools).toMatchObject([
    { type: "function", function: { name: "lookup", parameters: { type: "object" } } },
  ]);
});
it("serializes a complete tool loop transcript", async () => {
  const t = transport(fixture("azure-openai", "complete-json"));
  await new AzureOpenAiProvider({
    endpoint: "https://fictional.openai.azure.com",
    apiKey: "fictional",
    deployments: { small: "tiny", everyday: "daily", insight: "weekly", embed: "vectors" },
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
      tool_calls: [{ id: "call_1", function: { name: "lookup", arguments: '{"query":"apple"}' } }],
    },
    { role: "tool", tool_call_id: "call_1", content: '{"name":"Apple"}' },
  ]);
});
it("sends the photo in the provider's image field", async () => {
  const t = transport(fixture("azure-openai", "vision"));
  expect(
    await new AzureOpenAiProvider({
      endpoint: "https://fictional.openai.azure.com",
      apiKey: "fictional",
      deployments: { small: "tiny", everyday: "daily", insight: "weekly", embed: "vectors" },
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
    {
      role: "user",
      content: [
        { type: "image_url", image_url: { url: "data:image/jpeg;base64,ZmljdGlvbmFs" } },
        { type: "text", text: "Describe food" },
      ],
    },
  ]);
});
it("returns refusal", async () => {
  const t = transport(fixture("azure-openai", "complete-refusal"));
  expect(
    await new AzureOpenAiProvider({
      endpoint: "https://fictional.openai.azure.com",
      apiKey: "fictional",
      deployments: { small: "tiny", everyday: "daily", insight: "weekly", embed: "vectors" },
      fetch: t.fetch,
    }).complete(request),
  ).toMatchObject({ kind: "refusal" });
});
it("embeds with a ten second deadline and enforces 1024 dimensions", async () => {
  const timeout = vi.spyOn(AbortSignal, "timeout");
  const t = transport(fixture("azure-openai", "embed"));
  expect(
    (
      await new AzureOpenAiProvider({
        endpoint: "https://fictional.openai.azure.com",
        apiKey: "fictional",
        deployments: { small: "tiny", everyday: "daily", insight: "weekly", embed: "vectors" },
        fetch: t.fetch,
      }).embed({ texts: ["Apple"] })
    ).vectors[0],
  ).toHaveLength(1024);
  expect(timeout).toHaveBeenCalledWith(10_000);
  expect(t.calls[0]?.body).toMatchObject({ dimensions: 1024, input: ["Apple"] });
  const bad = transport(fixture("azure-openai", "embed-1536"));
  await expect(
    new AzureOpenAiProvider({
      endpoint: "https://fictional.openai.azure.com",
      apiKey: "fictional",
      deployments: { small: "tiny", everyday: "daily", insight: "weekly", embed: "vectors" },
      fetch: bad.fetch,
    }).embed({ texts: ["Apple"] }),
  ).rejects.toMatchObject({ code: "ai-unavailable" });
});
it.each([429, 500, 503])("maps HTTP %s and logs only the status", async (status) => {
  const lines: string[] = [];
  const t = transport({ error: "PRIVATE" }, status);
  await expect(
    new AzureOpenAiProvider({
      ...{
        endpoint: "https://fictional.openai.azure.com",
        apiKey: "fictional",
        deployments: { small: "tiny", everyday: "daily", insight: "weekly", embed: "vectors" },
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
    new AzureOpenAiProvider({
      ...{
        endpoint: "https://fictional.openai.azure.com",
        apiKey: "fictional",
        deployments: { small: "tiny", everyday: "daily", insight: "weekly", embed: "vectors" },
        fetch: t.fetch,
      },
      logger: createLogger((line) => lines.push(line)),
    }).complete(request),
  ).rejects.toMatchObject({ code: "ai-unavailable" });
  expect(lines.join()).not.toContain("PRIVATE");
});
it("uses injected token authentication and maps identity failure to unavailable", async () => {
  const t = transport(fixture("azure-openai", "complete-json"));
  const tokenProvider = vi.fn(() => Promise.resolve("FICTIONAL_TOKEN"));
  const provider = new AzureOpenAiProvider({
    endpoint: "https://fictional.openai.azure.com",
    deployments: { everyday: "daily" },
    tokenProvider,
    fetch: t.fetch,
  });
  await provider.complete(request);
  expect(t.calls[0]?.headers.get("authorization")).toBe("Bearer FICTIONAL_TOKEN");
  expect(t.calls[0]?.headers.has("api-key")).toBe(false);
  tokenProvider.mockRejectedValue(new Error("PRIVATE"));
  await expect(provider.complete(request)).rejects.toMatchObject({ code: "ai-unavailable" });
  expect(t.calls).toHaveLength(1);
});
it("makes optional output properties nullable in Azure's strict schema and restores absence", async () => {
  const t = transport({
    choices: [{ finish_reason: "stop", message: { content: '{"name":"Apple","grams":null}' } }],
  });
  const { z } = await import("zod");
  const schema = z.object({ name: z.string(), grams: z.number().optional() });
  const result = await new AzureOpenAiProvider({
    endpoint: "https://fictional.openai.azure.com",
    apiKey: "fictional",
    deployments: { everyday: "daily" },
    fetch: t.fetch,
  }).complete({ ...request, outputSchema: schema });
  expect(t.calls[0]?.body.response_format).toMatchObject({
    json_schema: {
      schema: {
        required: ["name", "grams"],
        additionalProperties: false,
        properties: { grams: { anyOf: [{ type: "number" }, { type: "null" }] } },
      },
    },
  });
  expect(result).toMatchObject({ kind: "json", json: { name: "Apple" } });
  if (result.kind === "json") expect(schema.parse(result.json)).toEqual({ name: "Apple" });
});
it("restores optional tool arguments before the provider-neutral loop validates them", async () => {
  const { z } = await import("zod");
  const t = transport({
    choices: [
      {
        finish_reason: "tool_calls",
        message: {
          content: null,
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "lookup", arguments: '{"query":"apple","limit":null}' },
            },
          ],
        },
      },
    ],
  });
  const result = await new AzureOpenAiProvider({
    endpoint: "https://fictional.openai.azure.com",
    apiKey: "fictional",
    deployments: { everyday: "daily" },
    fetch: t.fetch,
  }).complete({
    ...request,
    tools: [
      {
        name: "lookup",
        description: "Find food",
        inputSchema: z.object({ query: z.string(), limit: z.number().optional() }),
      },
    ],
  });
  expect(result).toMatchObject({ kind: "tool-calls", calls: [{ input: { query: "apple" } }] });
  if (result.kind === "tool-calls") expect(result.calls[0]?.input).not.toHaveProperty("limit");
});

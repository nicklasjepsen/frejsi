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
const failing = (error: Error) => {
  const lines: string[] = [];
  const client = new Anthropic({ apiKey: "fictional", fetch: transport({}).fetch, maxRetries: 0 });
  vi.spyOn(client.messages, "create").mockRejectedValue(error);
  const run = new AnthropicProvider({
    client,
    logger: createLogger((line) => lines.push(line)),
  }).complete(request);
  return { lines, run };
};
const apiBody = (message: string) => ({
  type: "error",
  error: { type: "invalid_request_error", message },
});
it("logs the class of an SDK error that has no API message", async () => {
  const { lines, run } = failing(new Anthropic.APIConnectionError({ message: "PRIVATE" }));
  await expect(run).rejects.toMatchObject({ code: "ai-unavailable" });
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain('"error":"APIConnectionError"');
  expect(lines[0]).not.toContain("PRIVATE");
});
it("logs the API's own error message, status and request id", async () => {
  const limit = "Schemas contains too many optional parameters (36). (limit: 24).";
  const { lines, run } = failing(
    new Anthropic.BadRequestError(
      400,
      apiBody(limit),
      "PRIVATE",
      new Headers({ "request-id": "req_fictional" }),
    ),
  );
  await expect(run).rejects.toMatchObject({ code: "ai-unavailable" });
  expect(JSON.parse(lines[0] ?? "")).toMatchObject({
    error: "BadRequestError",
    code: 400,
    apiMessage: limit,
    requestId: "req_fictional",
  });
  expect(lines[0]).not.toContain("PRIVATE");
});
it("never logs quoted text from an API message, which could echo the request, or a long one", async () => {
  const { lines, run } = failing(
    new Anthropic.BadRequestError(
      400,
      apiBody(
        `Unexpected value "two slices of rye" at 'PRIVATE' and \`PRIVATE\`. ${"x".repeat(900)}`,
      ),
      "PRIVATE",
      new Headers(),
    ),
  );
  await expect(run).rejects.toMatchObject({ code: "ai-unavailable" });
  expect(lines[0]).not.toContain("rye");
  expect(lines[0]).not.toContain("PRIVATE");
  expect((JSON.parse(lines[0] ?? "") as { apiMessage: string }).apiMessage.length).toBe(300);
});
it("logs why a response that did not finish was unusable", async () => {
  const lines: string[] = [];
  const t = transport({
    id: "fictional",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5-5",
    stop_reason: "max_tokens",
    content: [{ type: "text", text: "{" }],
    usage: { input_tokens: 1, output_tokens: 1 },
  });
  await expect(
    new AnthropicProvider({
      apiKey: "fictional",
      fetch: t.fetch,
      logger: createLogger((line) => lines.push(line)),
    }).complete(request),
  ).rejects.toMatchObject({ code: "ai-unavailable" });
  expect(lines[0]).toContain('"stopReason":"max_tokens"');
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

/** Every property a request's strict schemas leave optional or make a union, with refs inlined. */
function grammarCost(schemas: unknown[]) {
  let optional = 0;
  let unions = 0;
  const unsupported: string[] = [];
  const walk = (node: unknown, defs: Record<string, unknown>): void => {
    if (Array.isArray(node)) {
      node.forEach((entry) => {
        walk(entry, defs);
      });
      return;
    }
    if (!node || typeof node !== "object") return;
    const schema = node as Record<string, unknown>;
    if (typeof schema.$ref === "string") {
      walk(defs[schema.$ref.replace("#/$defs/", "")], defs);
      return;
    }
    for (const key of ["minLength", "maxLength", "minimum", "maximum", "multipleOf", "pattern"])
      if (key in schema) unsupported.push(key);
    if (Array.isArray(schema.anyOf) || Array.isArray(schema.type)) unions++;
    if (schema.properties && typeof schema.properties === "object") {
      const required = new Set((schema.required as string[] | undefined) ?? []);
      for (const [name, value] of Object.entries(schema.properties)) {
        if (!required.has(name)) optional++;
        walk(value, defs);
      }
    }
    walk(schema.items, defs);
    walk(schema.anyOf, defs);
    walk(schema.allOf, defs);
  };
  for (const schema of schemas) {
    const root = schema as { $defs?: Record<string, unknown> };
    walk(schema, root.$defs ?? {});
  }
  return { optional, unions, unsupported };
}
const finished = {
  id: "fictional",
  type: "message",
  role: "assistant",
  model: "claude-sonnet-5-5",
  stop_reason: "end_turn",
  content: [{ type: "text", text: "{}" }],
  usage: { input_tokens: 1, output_tokens: 1 },
};
it("sends Say entry inside the API's limits on strict schemas (#250)", async () => {
  const { ParsedMealDraft } = await import("../../schemas/ai");
  const { lookupTool } = await import("../parse/tool");
  const t = transport(finished);
  await new AnthropicProvider({ apiKey: "fictional", fetch: t.fetch })
    .complete({ ...request, outputSchema: ParsedMealDraft, tools: [lookupTool] })
    .catch(() => undefined);
  const body = t.calls[0]?.body as {
    output_config: { format: { schema: unknown } };
    tools: { input_schema: unknown }[];
  };
  const cost = grammarCost([
    body.output_config.format.schema,
    ...body.tools.map((tool) => tool.input_schema),
  ]);
  expect(cost.optional).toBeLessThanOrEqual(24);
  expect(cost.unions).toBeLessThanOrEqual(16);
  expect(cost.unsupported).toEqual([]);
});
it("keeps every other AI output contract inside the same limits", async () => {
  const ai = await import("../../schemas/ai");
  for (const schema of [
    ai.PhotoEstimate,
    ai.NormalisedFood,
    ai.MealInsight,
    ai.WeekInsight,
    ai.RecipeParse,
  ]) {
    const t = transport(finished);
    await new AnthropicProvider({ apiKey: "fictional", fetch: t.fetch })
      .complete({ ...request, outputSchema: schema })
      .catch(() => undefined);
    const body = t.calls[0]?.body as { output_config: { format: { schema: unknown } } };
    const cost = grammarCost([body.output_config.format.schema]);
    expect(cost.optional).toBeLessThanOrEqual(24);
    expect(cost.unions).toBeLessThanOrEqual(16);
  }
});

import Anthropic from "@anthropic-ai/sdk";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { log, type Logger } from "../../log";
import type {
  AiProvider,
  CompleteRequest,
  CompleteResult,
  EmbedRequest,
  VisionRequest,
} from "../types";
import { VoyageEmbeddings } from "../voyage/embeddings";
import { deadlines, notConfigured, parseText, unavailable } from "../azure-openai/protocol";

const models = {
  small: "claude-haiku-5-5",
  everyday: "claude-sonnet-5-5",
  insight: "claude-fable-5-1",
};
function outputFormat(schema: z.ZodType) {
  try {
    return zodOutputFormat(schema);
  } catch {
    // Existing contracts transform barcode strings. Describe their input representation;
    // CappedAiProvider still validates/transforms the response with the original contract.
    return jsonSchemaOutputFormat(
      z.toJSONSchema(schema, { io: "input" }) as Parameters<typeof jsonSchemaOutputFormat>[0],
    );
  }
}
interface Options {
  apiKey?: string | undefined;
  client?: Anthropic;
  voyageApiKey?: string | undefined;
  fetch?: typeof globalThis.fetch | undefined;
  logger?: Logger | undefined;
}
export class AnthropicProvider implements AiProvider {
  readonly id = "anthropic";
  private readonly client: Anthropic;
  private readonly voyage?: VoyageEmbeddings;
  constructor(private readonly options: Options) {
    this.client =
      options.client ??
      new Anthropic({
        apiKey: options.apiKey,
        fetch: options.fetch,
        maxRetries: 0,
        logLevel: "off",
      });
    if (options.voyageApiKey)
      this.voyage = new VoyageEmbeddings({
        apiKey: options.voyageApiKey,
        fetch: options.fetch,
        logger: options.logger,
      });
  }
  capabilities() {
    return { complete: true, vision: true, embed: !!this.voyage };
  }
  async embed(req: EmbedRequest) {
    if (!this.voyage) throw notConfigured();
    return this.voyage.embed(req);
  }
  complete(req: CompleteRequest): Promise<CompleteResult> {
    const messages: Anthropic.MessageParam[] = req.messages.map((message) => ({
      role: message.role,
      content: message.content.map((part): Anthropic.ContentBlockParam => {
        if (part.type === "text") return part;
        if (part.type === "tool-call")
          return { type: "tool_use", id: part.id, name: part.name, input: part.input };
        return {
          type: "tool_result",
          tool_use_id: part.toolCallId,
          content: JSON.stringify(part.result),
        };
      }),
    }));
    return this.invoke(req, messages);
  }
  vision(req: VisionRequest): Promise<CompleteResult> {
    return this.invoke(req, [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: req.image.mediaType, data: req.image.base64 },
          },
          { type: "text", text: req.prompt },
        ],
      },
    ]);
  }
  private async invoke(
    req: CompleteRequest | VisionRequest,
    messages: Anthropic.MessageParam[],
  ): Promise<CompleteResult> {
    if (req.role === "embed") throw notConfigured();
    const model = models[req.role];
    try {
      const tools = "tools" in req ? req.tools : undefined;
      const response = await this.client.messages.create(
        {
          model,
          system: req.system,
          messages,
          max_tokens: "maxTokens" in req ? (req.maxTokens ?? 4096) : 4096,
          output_config: {
            effort: "effort" in req ? (req.effort ?? "low") : "low",
            ...(req.outputSchema ? { format: outputFormat(req.outputSchema) } : {}),
          },
          ...(tools?.length
            ? {
                tools: tools.map((tool) => ({
                  name: tool.name,
                  description: tool.description,
                  strict: true,
                  input_schema: z.toJSONSchema(tool.inputSchema, {
                    io: "input",
                  }) as Anthropic.Tool.InputSchema,
                })),
                tool_choice: { type: "auto" as const },
              }
            : {}),
        },
        { timeout: deadlines[req.role], maxRetries: 0 },
      );
      if (response.stop_reason === "refusal") return { kind: "refusal", model };
      const calls = response.content.filter((part) => part.type === "tool_use");
      if (calls.length)
        return {
          kind: "tool-calls",
          calls: calls.map((call) => ({
            id: call.id,
            name: call.name,
            input:
              typeof call.input === "string" ? (JSON.parse(call.input) as unknown) : call.input,
          })),
          model,
        };
      if (response.stop_reason !== "end_turn") throw unavailable();
      const text = response.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("");
      return parseText(text, !!req.outputSchema, model);
    } catch (error) {
      const safe = new Error();
      safe.name = error instanceof Error ? error.constructor.name : "UnknownError";
      (this.options.logger ?? log).error("AI request unavailable", undefined, safe);
      throw unavailable();
    }
  }
}

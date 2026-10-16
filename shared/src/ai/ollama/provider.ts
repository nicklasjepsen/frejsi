import { z } from "zod";
import type { Logger } from "../../log";
import type {
  AiProvider,
  CompleteRequest,
  CompleteResult,
  EmbedRequest,
  VisionRequest,
} from "../types";
import {
  chatMessages,
  deadlines,
  embeddings,
  notConfigured,
  parseCalls,
  parseText,
  postJson,
  unavailable,
} from "../azure-openai/protocol";

export interface OllamaOptions {
  url: string;
  models?: {
    small?: string | undefined;
    everyday?: string | undefined;
    insight?: string | undefined;
    embed?: string | undefined;
  };
  fetch?: typeof globalThis.fetch | undefined;
  logger?: Logger | undefined;
}
export class OllamaProvider implements AiProvider {
  readonly id = "ollama";
  constructor(private readonly options: OllamaOptions) {}
  capabilities() {
    return {
      complete: !!this.options.models?.everyday,
      vision: !!this.options.models?.everyday,
      embed: true,
    };
  }
  complete(req: CompleteRequest) {
    return this.chat(req, chatMessages(req.messages, true));
  }
  vision(req: VisionRequest) {
    return this.chat(req, [{ role: "user", content: req.prompt, images: [req.image.base64] }]);
  }
  async embed(req: EmbedRequest) {
    const model = this.options.models?.embed ?? "mxbai-embed-large";
    const response = await this.post(
      "embed",
      { model, input: req.texts, dimensions: 1024 },
      deadlines.embed,
    );
    const parsed = z.object({ embeddings: z.unknown() }).safeParse(response);
    if (!parsed.success) throw unavailable();
    return embeddings(parsed.data.embeddings, req.texts.length, `ollama:${model}`, false);
  }
  private async chat(
    req: CompleteRequest | VisionRequest,
    messages: Record<string, unknown>[],
  ): Promise<CompleteResult> {
    if (req.role === "embed") throw notConfigured();
    const model = this.options.models?.[req.role];
    if (!model) throw notConfigured();
    const tools = "tools" in req ? req.tools : undefined;
    const response = await this.post(
      "chat",
      {
        model,
        stream: false,
        messages: [{ role: "system", content: req.system }, ...messages],
        options: { num_predict: "maxTokens" in req ? (req.maxTokens ?? 4096) : 4096 },
        ...(req.outputSchema ? { format: z.toJSONSchema(req.outputSchema, { io: "input" }) } : {}),
        ...(tools?.length
          ? {
              tools: tools.map((tool) => ({
                type: "function",
                function: {
                  name: tool.name,
                  description: tool.description,
                  parameters: z.toJSONSchema(tool.inputSchema, { io: "input" }),
                },
              })),
            }
          : {}),
      },
      deadlines[req.role],
    );
    const parsed = z
      .object({
        done: z.literal(true),
        done_reason: z.string().optional(),
        message: z.object({
          content: z.string(),
          refusal: z.string().optional(),
          tool_calls: z.unknown().optional(),
        }),
      })
      .safeParse(response);
    if (!parsed.success) throw unavailable();
    const result = parsed.data;
    const provenance = `ollama:${model}`;
    if (result.message.refusal) return { kind: "refusal", model: provenance };
    try {
      if (result.message.tool_calls)
        return {
          kind: "tool-calls",
          calls: parseCalls(result.message.tool_calls, true),
          model: provenance,
        };
      if (result.done_reason === "length") throw unavailable();
      return parseText(result.message.content, !!req.outputSchema, provenance);
    } catch {
      throw unavailable();
    }
  }
  private post(path: string, body: unknown, ms: number) {
    return postJson(
      this.options.fetch ?? globalThis.fetch,
      `${this.options.url.replace(/\/$/, "")}/api/${path}`,
      body,
      () => Promise.resolve({}),
      ms,
      this.options.logger,
    );
  }
}

import { z } from "zod";
import { azureSchema, restoreOptionals } from "./schema";
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
} from "./protocol";

export interface AzureOpenAiOptions {
  endpoint: string;
  deployments: {
    small?: string | undefined;
    everyday?: string | undefined;
    insight?: string | undefined;
    embed?: string | undefined;
  };
  apiKey?: string | undefined;
  tokenProvider?: (() => Promise<string>) | undefined;
  fetch?: typeof globalThis.fetch | undefined;
  logger?: Logger | undefined;
}
export class AzureOpenAiProvider implements AiProvider {
  readonly id = "azure-openai";
  constructor(private readonly options: AzureOpenAiOptions) {}
  capabilities() {
    return {
      complete: !!this.options.deployments.everyday,
      vision: !!this.options.deployments.everyday,
      embed: true,
    };
  }
  complete(req: CompleteRequest) {
    return this.chat(req, chatMessages(req.messages, false));
  }
  vision(req: VisionRequest) {
    return this.chat(req, [
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: `data:${req.image.mediaType};base64,${req.image.base64}` },
          },
          { type: "text", text: req.prompt },
        ],
      },
    ]);
  }
  async embed(req: EmbedRequest) {
    const requested = this.options.deployments.embed;
    const deployment = requested?.length ? requested : "text-embedding-3-small";
    const response = await this.post(
      deployment,
      "embeddings",
      { input: req.texts, dimensions: 1024 },
      deadlines.embed,
    );
    const parsed = z.object({ data: z.unknown() }).safeParse(response);
    if (!parsed.success) throw unavailable();
    return embeddings(parsed.data.data, req.texts.length, `azure-openai:${deployment}`);
  }
  private async chat(
    req: CompleteRequest | VisionRequest,
    messages: Record<string, unknown>[],
  ): Promise<CompleteResult> {
    if (req.role === "embed") throw notConfigured();
    const deployment = this.options.deployments[req.role];
    if (!deployment) throw notConfigured();
    const tools = "tools" in req ? req.tools : undefined;
    const response = await this.post(
      deployment,
      "chat/completions",
      {
        messages: [{ role: "system", content: req.system }, ...messages],
        max_completion_tokens: "maxTokens" in req ? (req.maxTokens ?? 4096) : 4096,
        ...(req.outputSchema
          ? {
              response_format: {
                type: "json_schema",
                json_schema: {
                  name: "response",
                  strict: true,
                  schema: azureSchema(req.outputSchema),
                },
              },
            }
          : {}),
        ...(tools?.length
          ? {
              tools: tools.map((tool) => ({
                type: "function",
                function: {
                  name: tool.name,
                  description: tool.description,
                  strict: true,
                  parameters: azureSchema(tool.inputSchema),
                },
              })),
              tool_choice: "auto",
            }
          : {}),
      },
      deadlines[req.role],
    );
    const parsed = z
      .object({
        choices: z
          .array(
            z.object({
              finish_reason: z.string(),
              message: z.object({
                content: z.string().nullish(),
                refusal: z.string().nullish(),
                tool_calls: z.unknown().optional(),
              }),
            }),
          )
          .min(1),
      })
      .safeParse(response);
    if (!parsed.success) throw unavailable();
    const choice = parsed.data.choices[0];
    if (!choice) throw unavailable();
    const model = `azure-openai:${deployment}`;
    if (choice.message.refusal || choice.finish_reason === "content_filter")
      return { kind: "refusal", model };
    try {
      if (choice.message.tool_calls) {
        const calls = parseCalls(choice.message.tool_calls, false).map((call) => {
          const tool = tools?.find((tool) => tool.name === call.name);
          return tool ? { ...call, input: restoreOptionals(call.input, tool.inputSchema) } : call;
        });
        return { kind: "tool-calls", calls, model };
      }
      if (choice.finish_reason !== "stop") throw unavailable();
      const result = parseText(choice.message.content ?? "", !!req.outputSchema, model);
      return result.kind === "json" && req.outputSchema
        ? { ...result, json: restoreOptionals(result.json, req.outputSchema) }
        : result;
    } catch {
      throw unavailable();
    }
  }
  private post(deployment: string, path: string, body: unknown, ms: number) {
    const url = `${this.options.endpoint.replace(/\/$/, "")}/openai/deployments/${encodeURIComponent(deployment)}/${path}?api-version=2024-10-21`;
    return postJson(
      this.options.fetch ?? globalThis.fetch,
      url,
      body,
      async () => {
        if (this.options.apiKey) return { "api-key": this.options.apiKey };
        if (!this.options.tokenProvider) throw notConfigured();
        const token = await this.options.tokenProvider();
        if (!token) throw unavailable();
        return { authorization: `Bearer ${token}` };
      },
      ms,
      this.options.logger,
    );
  }
}

import type { z } from "zod";
import type { AiProviderId, ModelRole } from "../schemas/ai";

export type AiUse =
  | "search"
  | "normalise"
  | "parse"
  | "estimate"
  | "insight-meal"
  | "insight-week"
  | "backfill"
  | "recipe";
export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}
export type AiContent =
  | { type: "text"; text: string }
  | ({ type: "tool-call" } & ToolCall)
  | { type: "tool-result"; toolCallId: string; result: unknown };
export interface AiMessage {
  role: "user" | "assistant";
  content: AiContent[];
}
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodType;
}
export interface CompleteRequest {
  role: ModelRole;
  system: string;
  messages: AiMessage[];
  tools?: ToolDefinition[];
  outputSchema?: z.ZodType;
  maxTokens?: number;
  effort?: "low" | "medium";
  use?: AiUse;
}
export interface VisionRequest {
  role: ModelRole;
  system: string;
  image: { mediaType: "image/jpeg"; base64: string };
  prompt: string;
  outputSchema: z.ZodType;
  use?: AiUse;
}
export interface EmbedRequest {
  texts: string[];
  use?: AiUse;
}
export interface EmbedResult {
  vectors: number[][];
  model: string;
}
export type CompleteResult =
  | { kind: "json"; json: unknown; model: string }
  | { kind: "tool-calls"; calls: ToolCall[]; model: string }
  | { kind: "text"; text: string; model: string }
  | { kind: "refusal"; model: string };
export interface AiCapabilities {
  complete: boolean;
  vision: boolean;
  embed: boolean;
}
export interface AiProvider {
  readonly id: AiProviderId | "fake" | "capped";
  complete(req: CompleteRequest): Promise<CompleteResult>;
  vision(req: VisionRequest): Promise<CompleteResult>;
  embed(req: EmbedRequest): Promise<EmbedResult>;
  capabilities(): AiCapabilities;
}

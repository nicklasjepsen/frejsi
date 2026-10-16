import { z } from "zod";
import { log, type Logger } from "../../log";
import { HttpError } from "../../schemas/api";
import type { AiMessage, CompleteResult, EmbedResult, ToolCall } from "../types";

export const deadlines = { small: 20_000, everyday: 30_000, insight: 120_000, embed: 10_000 };
export const unavailable = () => new HttpError(503, "ai-unavailable");
export const notConfigured = () => new HttpError(503, "ai-not-configured");

/** Shared HTTP mechanics, with no vendor host, credential lookup or prompt. */
export async function postJson(
  fetch: typeof globalThis.fetch,
  url: string,
  body: unknown,
  headers: () => Promise<Record<string, string>>,
  ms: number,
  logger: Logger = log,
): Promise<unknown> {
  const signal = AbortSignal.timeout(ms);
  let status = 0;
  try {
    // The deadline covers identity acquisition as well as transport and response reading.
    return await new Promise<unknown>((resolve, reject) => {
      const abort = () => {
        reject(unavailable());
      };
      signal.addEventListener("abort", abort, { once: true });
      void (async () => {
        try {
          const auth = await headers();
          signal.throwIfAborted();
          const response = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json", ...auth },
            body: JSON.stringify(body),
            signal,
          });
          status = response.status;
          if (!response.ok) throw unavailable();
          resolve(await response.json());
        } catch {
          reject(unavailable());
        } finally {
          signal.removeEventListener("abort", abort);
        }
      })();
    });
  } catch {
    logger.warn("AI request unavailable", { code: status });
    throw unavailable();
  }
}

const vector = z.array(z.number()).length(1024);
export function embeddings(
  data: unknown,
  count: number,
  model: string,
  indexed = true,
): EmbedResult {
  try {
    if (!indexed) return { vectors: z.array(vector).length(count).parse(data), model };
    const rows = z
      .array(z.object({ index: z.number().int().nonnegative(), embedding: vector }))
      .length(count)
      .parse(data);
    rows.sort((a, b) => a.index - b.index);
    if (rows.some((row, index) => row.index !== index)) throw unavailable();
    return { vectors: rows.map((row) => row.embedding), model };
  } catch {
    throw unavailable();
  }
}

export function parseText(text: string, structured: boolean, model: string): CompleteResult {
  if (!structured) return { kind: "text", text, model };
  try {
    return { kind: "json", json: JSON.parse(text) as unknown, model };
  } catch {
    throw unavailable();
  }
}
export function parseCalls(value: unknown, ollama: boolean): ToolCall[] {
  const calls = z
    .array(
      z.object({
        id: z.string().optional(),
        function: z.object({ name: z.string(), arguments: z.unknown() }),
      }),
    )
    .min(1)
    .parse(value);
  return calls.map((call, index) => ({
    id: call.id ?? `call_${index}`,
    name: call.function.name,
    input:
      typeof call.function.arguments === "string"
        ? (JSON.parse(call.function.arguments) as unknown)
        : ollama
          ? call.function.arguments
          : z.never().parse(call.function.arguments),
  }));
}

/** Convert the neutral transcript, keeping parallel tool results as individual messages. */
export function chatMessages(messages: AiMessage[], ollama: boolean): Record<string, unknown>[] {
  const toolNames = new Map<string, string>();
  return messages.flatMap((message) => {
    const text = message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");
    const calls = message.content.filter((part) => part.type === "tool-call");
    const results = message.content.filter((part) => part.type === "tool-result");
    for (const call of calls) toolNames.set(call.id, call.name);
    const out: Record<string, unknown>[] = [];
    if (text || calls.length || !results.length)
      out.push({
        role: message.role,
        content: text,
        ...(calls.length
          ? {
              tool_calls: calls.map((call) => ({
                ...(ollama ? {} : { id: call.id }),
                type: "function",
                function: {
                  name: call.name,
                  arguments: ollama ? call.input : JSON.stringify(call.input),
                },
              })),
            }
          : {}),
      });
    for (const result of results)
      out.push({
        role: "tool",
        content: JSON.stringify(result.result),
        ...(ollama
          ? { tool_name: toolNames.get(result.toolCallId) }
          : { tool_call_id: result.toolCallId }),
      });
    return out;
  });
}

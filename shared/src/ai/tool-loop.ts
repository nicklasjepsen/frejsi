import { HttpError } from "../schemas/api";
import type { AiMessage, AiProvider, CompleteRequest, CompleteResult } from "./types";

export type ToolHandlers = Record<string, (input: unknown) => Promise<unknown>>;
export async function runToolLoop(
  provider: AiProvider,
  req: CompleteRequest,
  tools: ToolHandlers,
  options: { maxCalls?: number } = {},
): Promise<Extract<CompleteResult, { kind: "json" }>> {
  const maxCalls = options.maxCalls ?? 8;
  if (!Number.isSafeInteger(maxCalls) || maxCalls < 0 || maxCalls > 8)
    throw new HttpError(502, "ai-rejected");
  let used = 0;
  const messages: AiMessage[] = [...req.messages];
  for (;;) {
    const result = await provider.complete({ ...req, messages });
    if (result.kind === "json") return result;
    if (result.kind === "refusal") throw new HttpError(503, "ai-unavailable");
    if (
      result.kind !== "tool-calls" ||
      result.calls.length === 0 ||
      used + result.calls.length > maxCalls
    )
      throw new HttpError(502, "ai-rejected");
    const ids = new Set<string>();
    for (const call of result.calls) {
      if (!Object.hasOwn(tools, call.name) || ids.has(call.id))
        throw new HttpError(502, "ai-rejected");
      ids.add(call.id);
    }
    used += result.calls.length;
    const results = await Promise.all(
      result.calls.map(async (call) => {
        const handler = tools[call.name];
        if (!handler) throw new HttpError(502, "ai-rejected");
        let value: unknown;
        try {
          value = await handler(call.input);
        } catch {
          value = { error: { code: "tool-unavailable" } };
        }
        return { type: "tool-result" as const, toolCallId: call.id, result: value };
      }),
    );
    messages.push(
      { role: "assistant", content: result.calls.map((call) => ({ type: "tool-call", ...call })) },
      { role: "user", content: results },
    );
  }
}

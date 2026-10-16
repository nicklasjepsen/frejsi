import { readFileSync } from "node:fs";
import { z } from "zod";
import { vi } from "vitest";
import type { CompleteRequest } from "../types";

export const outputSchema = z.object({ name: z.string() });
export const request: CompleteRequest = {
  role: "everyday",
  system: "Return the food name.",
  messages: [{ role: "user", content: [{ type: "text", text: "An apple" }] }],
  outputSchema,
};
export const tools = [
  { name: "lookup", description: "Find food", inputSchema: z.object({ query: z.string() }) },
];
export function fixture(vendor: string, name: string): unknown {
  return JSON.parse(
    readFileSync(
      new URL(`../../../../fixtures/ai/${vendor}/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as unknown;
}
export function transport(body: unknown, status = 200) {
  const calls: {
    url: string;
    body: Record<string, unknown>;
    headers: Headers;
    signal: AbortSignal | null | undefined;
  }[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const req = input instanceof Request ? input : undefined;
    const requestBody = req ? await req.text() : init?.body;
    if (typeof requestBody !== "string") throw new Error("Expected JSON request body");
    calls.push({
      url: input instanceof Request ? input.url : input instanceof URL ? input.href : input,
      body: JSON.parse(requestBody) as Record<string, unknown>,
      headers: new Headers(init?.headers ?? req?.headers),
      signal: init?.signal ?? req?.signal,
    });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  });
  return { calls, fetch };
}

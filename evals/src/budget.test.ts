import { expect, it, vi } from "vitest";
import { RunBudget } from "./budget";
import { aiProviders } from "@frejsi/shared/ai";
it("retries 429 after the header delay and counts retries toward the transport cap", async () => {
  vi.useFakeTimers();
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(new Response("", { status: 429, headers: { "retry-after": "2" } }))
    .mockResolvedValue(new Response("ok"));
  const budget = new RunBudget({ fetch, maxCalls: 2 });
  const promise = budget.fetch("https://example.invalid");
  await vi.advanceTimersByTimeAsync(1999);
  expect(fetch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect((await promise).status).toBe(200);
  await expect(budget.fetch("https://example.invalid")).rejects.toThrow("call cap");
  expect(fetch).toHaveBeenCalledTimes(2);
  budget.close();
  vi.useRealTimers();
});
it("understands HTTP-date retry-after and aborts at the wall-clock deadline", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-12T00:00:00Z"));
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
    new Response("", {
      status: 429,
      headers: { "retry-after": "Mon, 12 Oct 2026 00:00:02 GMT" },
    }),
  );
  const budget = new RunBudget({ fetch, milliseconds: 1000 });
  const result = budget
    .run(() => budget.fetch("https://example.invalid"))
    .catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(1000);
  expect(await result).toBeInstanceOf(Error);
  expect(budget.signal.aborted).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(1);
  vi.useRealTimers();
});
it("passes the bounded transport through the registry into the real adapter without network", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
    new Response(
      JSON.stringify({
        id: "fictional",
        type: "message",
        role: "assistant",
        model: "fixture",
        content: [{ type: "text", text: '{"name":"Example bread","portions":[]}' }],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      { headers: { "content-type": "application/json" } },
    ),
  );
  const budget = new RunBudget({ fetch });
  const provider = aiProviders(
    { ANTHROPIC_API_KEY: "fictional-test-key" },
    { fetch: budget.fetch },
  ).anthropic;
  if (!provider) throw new Error("missing provider");
  const { normaliseFoodName } = await import("@frejsi/shared/ai/search/normalise");
  expect((await normaliseFoodName(provider, "EXAMPLE BREAD", "en"))?.name).toBe("Example bread");
  expect(budget.calls).toBe(1);
  budget.close();
});

it("allows a retry-after longer than the production request timeout within the eval budget", async () => {
  vi.useFakeTimers();
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(new Response("", { status: 429, headers: { "retry-after": "35" } }))
    .mockImplementation((_input, init) => {
      if (init?.signal?.aborted) return Promise.reject(new Error("request already aborted"));
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: "fictional",
            type: "message",
            role: "assistant",
            model: "fixture",
            content: [{ type: "text", text: '{"name":"Example bread","portions":[]}' }],
            stop_reason: "end_turn",
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
          { headers: { "content-type": "application/json" } },
        ),
      );
    });
  const budget = new RunBudget({ fetch });
  const provider = aiProviders(
    { ANTHROPIC_API_KEY: "fictional-test-key" },
    { fetch: budget.fetch, timeout: 180_000 },
  ).anthropic;
  if (!provider) throw new Error("missing provider");
  const { normaliseFoodName } = await import("@frejsi/shared/ai/search/normalise");
  const result = budget.run(() => normaliseFoodName(provider, "EXAMPLE BREAD", "en"));
  await vi.advanceTimersByTimeAsync(35_001);
  expect((await result)?.name).toBe("Example bread");
  expect(fetch).toHaveBeenCalledTimes(2);
  vi.useRealTimers();
});

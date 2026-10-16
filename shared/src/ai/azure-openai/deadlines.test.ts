import { afterEach, expect, it, vi } from "vitest";
import { AzureOpenAiProvider } from "./provider";
import { OllamaProvider } from "../ollama/provider";
import { VoyageEmbeddings } from "../voyage/embeddings";
import { AnthropicProvider } from "../anthropic/provider";
import { request } from "../anthropic/test-helpers";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it.each(["azure", "ollama", "voyage", "anthropic"])(
  "aborts an unresponsive %s transport without retrying",
  async (vendor) => {
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(() => {
        controller.abort();
      }, ms);
      return controller.signal;
    });
    const fetch = vi.fn<typeof globalThis.fetch>(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => {
              reject(new Error("PRIVATE"));
            },
            { once: true },
          );
        }),
    );
    const pending =
      vendor === "azure"
        ? new AzureOpenAiProvider({
            endpoint: "https://fictional.openai.azure.com",
            apiKey: "fictional",
            deployments: { everyday: "daily" },
            fetch,
          }).complete(request)
        : vendor === "ollama"
          ? new OllamaProvider({
              url: "http://127.0.0.1:11434",
              models: { everyday: "daily" },
              fetch,
            }).complete(request)
          : vendor === "voyage"
            ? new VoyageEmbeddings({ apiKey: "fictional", fetch }).embed({ texts: ["Apple"] })
            : new AnthropicProvider({ apiKey: "fictional", fetch }).complete(request);
    const assertion = expect(pending).rejects.toMatchObject({ code: "ai-unavailable" });
    await vi.advanceTimersByTimeAsync(vendor === "voyage" ? 10_000 : 30_000);
    await assertion;
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);
it("bounds an identity provider that never resolves without opening a socket", async () => {
  vi.useFakeTimers();
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
    const controller = new AbortController();
    setTimeout(() => {
      controller.abort();
    }, ms);
    return controller.signal;
  });
  const fetch = vi.fn<typeof globalThis.fetch>();
  const provider = new AzureOpenAiProvider({
    endpoint: "https://fictional.openai.azure.com",
    deployments: { small: "tiny" },
    fetch,
    tokenProvider: () =>
      new Promise(() => {
        /* Identity intentionally never settles. */
      }),
  });
  const assertion = expect(provider.complete({ ...request, role: "small" })).rejects.toMatchObject({
    code: "ai-unavailable",
  });
  await vi.advanceTimersByTimeAsync(20_000);
  await assertion;
  expect(fetch).not.toHaveBeenCalled();
});

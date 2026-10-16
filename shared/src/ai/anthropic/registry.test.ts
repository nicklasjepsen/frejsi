import { expect, it, vi } from "vitest";
import { aiProviders } from "../registry";
import { request } from "./test-helpers";

it("leaves an unconfigured deployment inert and registers only configured adapters", async () => {
  const network = vi.spyOn(globalThis, "fetch");
  try {
    expect(aiProviders({})).toEqual({});
    expect(aiProviders({ VOYAGE_API_KEY: "fictional" })).toEqual({});
    const anthropic = aiProviders({ ANTHROPIC_API_KEY: "fictional" });
    expect(Object.keys(anthropic)).toEqual(["anthropic"]);
    expect(anthropic.anthropic?.capabilities()).toEqual({
      complete: true,
      vision: true,
      embed: false,
    });
    expect(
      aiProviders({
        ANTHROPIC_API_KEY: "fictional",
        VOYAGE_API_KEY: "fictional",
      }).anthropic?.capabilities().embed,
    ).toBe(true);
    expect(aiProviders({ AZURE_OPENAI_ENDPOINT: "https://fictional.openai.azure.com" })).toEqual(
      {},
    );
    const azure = aiProviders({
      AZURE_OPENAI_ENDPOINT: "https://fictional.openai.azure.com",
      AZURE_OPENAI_DEPLOYMENT_EVERYDAY: "daily",
      AZURE_OPENAI_API_KEY: "fictional",
    });
    expect(Object.keys(azure)).toEqual(["azure-openai"]);
    expect(
      aiProviders({
        AZURE_OPENAI_ENDPOINT: "https://fictional.openai.azure.com",
        AZURE_OPENAI_DEPLOYMENT_EVERYDAY: "daily",
      })["azure-openai"]?.capabilities().complete,
    ).toBe(true);
    expect(aiProviders({ OLLAMA_URL: "http://127.0.0.1:11434" })).toEqual({});
    expect(
      Object.keys(
        aiProviders({ OLLAMA_URL: "http://127.0.0.1:11434", OLLAMA_MODEL_EVERYDAY: "local-food" }),
      ),
    ).toEqual(["ollama"]);
    const fake = aiProviders({ FAKE_AI_PROVIDER: "1", ANTHROPIC_API_KEY: "fictional" });
    expect(Object.keys(fake)).toEqual(["anthropic", "azure-openai", "ollama"]);
    for (const provider of Object.values(fake)) {
      expect(provider.id).toBe("fake");
      expect(await provider.complete(request)).toMatchObject({ kind: "json" });
    }
    expect(network).not.toHaveBeenCalled();
  } finally {
    network.mockRestore();
  }
});
it.each(["azure-openai", "ollama"] as const)(
  "treats blank optional %s roles from .env.example as absent",
  async (id) => {
    const { fixture, transport } = await import("./test-helpers");
    const t = transport(fixture(id, "complete-json"));
    vi.stubGlobal("fetch", t.fetch);
    try {
      const env =
        id === "azure-openai"
          ? {
              AZURE_OPENAI_ENDPOINT: "https://fictional.openai.azure.com",
              AZURE_OPENAI_API_KEY: "fictional",
              AZURE_OPENAI_DEPLOYMENT_EVERYDAY: "daily",
              AZURE_OPENAI_DEPLOYMENT_SMALL: "",
              AZURE_OPENAI_DEPLOYMENT_INSIGHT: "",
            }
          : {
              OLLAMA_URL: "http://127.0.0.1:11434",
              OLLAMA_MODEL_EVERYDAY: "daily",
              OLLAMA_MODEL_SMALL: "",
              OLLAMA_MODEL_INSIGHT: "",
            };
      const provider = aiProviders(env)[id];
      expect(provider).toBeDefined();
      for (const role of ["small", "insight"] as const) {
        expect(await provider?.complete({ ...request, role })).toMatchObject({ kind: "json" });
      }
    } finally {
      vi.unstubAllGlobals();
    }
  },
);

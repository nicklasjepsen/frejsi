import { DefaultAzureCredential, getBearerTokenProvider } from "@azure/identity";
import { AnthropicProvider } from "./anthropic/provider";
import { AzureOpenAiProvider } from "./azure-openai/provider";
import { OllamaProvider } from "./ollama/provider";
import { AiProviderId } from "../schemas/ai";
import { FakeAiProvider, defaultFakeAnswer, type FakeAiScript } from "./fake";
import type { AiProvider } from "./types";

export type AiProviderRegistry = Partial<Record<AiProviderId, AiProvider>>;
/** Adapters are added here by their lane. An unconfigured deployment sends nothing. */
export function aiProviders(
  env: Readonly<Record<string, string | undefined>>,
  options: { fakeScript?: FakeAiScript; fetch?: typeof globalThis.fetch; timeout?: number } = {},
): AiProviderRegistry {
  if (env.FAKE_AI_PROVIDER !== "1") {
    const providers: AiProviderRegistry = {};
    if (env.ANTHROPIC_API_KEY)
      providers.anthropic = new AnthropicProvider({
        apiKey: env.ANTHROPIC_API_KEY,
        fetch: options.fetch,
        timeout: options.timeout,
        voyageApiKey: env.VOYAGE_API_KEY,
      });
    if (env.AZURE_OPENAI_ENDPOINT && env.AZURE_OPENAI_DEPLOYMENT_EVERYDAY)
      providers["azure-openai"] = new AzureOpenAiProvider({
        endpoint: env.AZURE_OPENAI_ENDPOINT,
        apiKey: env.AZURE_OPENAI_API_KEY,
        tokenProvider: env.AZURE_OPENAI_API_KEY
          ? undefined
          : getBearerTokenProvider(
              new DefaultAzureCredential(),
              "https://cognitiveservices.azure.com/.default",
            ),
        deployments: {
          small: env.AZURE_OPENAI_DEPLOYMENT_SMALL?.length
            ? env.AZURE_OPENAI_DEPLOYMENT_SMALL
            : env.AZURE_OPENAI_DEPLOYMENT_EVERYDAY,
          everyday: env.AZURE_OPENAI_DEPLOYMENT_EVERYDAY,
          insight: env.AZURE_OPENAI_DEPLOYMENT_INSIGHT?.length
            ? env.AZURE_OPENAI_DEPLOYMENT_INSIGHT
            : env.AZURE_OPENAI_DEPLOYMENT_EVERYDAY,
          embed: env.AZURE_OPENAI_DEPLOYMENT_EMBED,
        },
      });
    if (env.OLLAMA_URL && env.OLLAMA_MODEL_EVERYDAY)
      providers.ollama = new OllamaProvider({
        url: env.OLLAMA_URL,
        models: {
          small: env.OLLAMA_MODEL_SMALL?.length
            ? env.OLLAMA_MODEL_SMALL
            : env.OLLAMA_MODEL_EVERYDAY,
          everyday: env.OLLAMA_MODEL_EVERYDAY,
          insight: env.OLLAMA_MODEL_INSIGHT?.length
            ? env.OLLAMA_MODEL_INSIGHT
            : env.OLLAMA_MODEL_EVERYDAY,
          embed: env.OLLAMA_MODEL_EMBED,
        },
      });
    return providers;
  }
  return Object.fromEntries(
    AiProviderId.options.map((id) => [
      id,
      new FakeAiProvider(options.fakeScript ?? defaultFakeAnswer),
    ]),
  );
}

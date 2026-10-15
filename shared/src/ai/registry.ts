import { AiProviderId } from "../schemas/ai";
import { FakeAiProvider } from "./fake";
import type { AiProvider } from "./types";

export type AiProviderRegistry = Partial<Record<AiProviderId, AiProvider>>;
/** Adapters are added here by their lane. An unconfigured deployment sends nothing. */
export function aiProviders(env: Readonly<Record<string, string | undefined>>): AiProviderRegistry {
  if (env.FAKE_AI_PROVIDER !== "1") return {};
  return Object.fromEntries(AiProviderId.options.map((id) => [id, new FakeAiProvider()]));
}

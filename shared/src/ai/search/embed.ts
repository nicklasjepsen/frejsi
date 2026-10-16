import type { SearchEmbed } from "../../food/types";
import type { AiProvider } from "../types";
import { embeddingIdentity } from "./model";
/** Only a provider returned by the web factory or the capped timer composition enters here. */
export function searchEmbed(provider: AiProvider, revision: string): SearchEmbed {
  return async (q) => {
    try {
      if (!provider.capabilities().embed) return null;
      const result = await provider.embed({ texts: [q], use: "search" });
      const vector = result.vectors[0];
      return vector ? { vector, model: embeddingIdentity(revision, result.model) } : null;
    } catch {
      return null;
    }
  };
}

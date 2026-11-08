import { lookup, type FoodRepository, type FoodSource, type SessionContext } from "@naensom/shared";
import type { AiProvider } from "@naensom/shared/ai";
import { parseMeal } from "@naensom/shared/ai/parse/parse";

export function parseForSession(
  deps: { provider: AiProvider; repo: FoodRepository; sources: FoodSource[] },
  spaceId: string,
  session: SessionContext,
  text: string,
  onToolCall: () => void,
) {
  return parseMeal(
    deps.provider,
    text,
    session.locale,
    (query) =>
      lookup(deps.repo, deps.sources, {
        spaceId,
        session,
        locale: session.locale,
        query: { q: query, remote: true },
      }),
    onToolCall,
  );
}

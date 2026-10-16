import { lookup, type FoodRepository, type FoodSource, type SessionContext } from "@frejsi/shared";
import type { AiProvider } from "@frejsi/shared/ai";
import { parseMeal } from "@frejsi/shared/ai/parse/parse";

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

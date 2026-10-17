import type { SessionContext } from "@frejsi/shared";
import { HttpError } from "@frejsi/shared";
import type { AiProvider } from "@frejsi/shared/ai";
import { parseRecipe, type ParsedRecipe, type RecipeInput } from "@frejsi/shared/ai/recipe/parse";
import { aiForSpace } from "@/ai/provider";
import { assertRole } from "@/lib/auth/session";

export interface ReadRecipeDeps {
  provider?: (spaceId: string, session: SessionContext) => Promise<AiProvider>;
}
let overrides: ReadRecipeDeps = {};
/** Tests only: a scripted provider in place of the space's capped one. */
export function configureRecipeReader(deps: ReadRecipeDeps): void {
  overrides = deps;
}

/** AI that is off or not configured is a state, not a failure, for a page that may carry JSON-LD. */
const OFF = new Set(["ai-disabled", "ai-not-configured"]);

/**
 * The one place the recipe feature touches a model: the space's provider from `aiForSpace`
 * (owner or carer, opt-in, configuration, the daily cap), then the shared `parseRecipe`. Text and
 * a photo need the provider; a fetched page tries JSON-LD first and only then the model, so AI
 * being off answers `recipe-unreadable` instead of `ai-disabled` for a page without it.
 */
export async function readRecipe(
  spaceId: string,
  session: SessionContext,
  input: RecipeInput,
): Promise<ParsedRecipe> {
  assertRole(session, spaceId, "owner", "carer");
  const factory = overrides.provider ?? aiForSpace;
  let provider: AiProvider | null;
  try {
    provider = await factory(spaceId, session);
  } catch (error) {
    if (input.kind === "html" && error instanceof HttpError && OFF.has(error.code)) provider = null;
    else throw error;
  }
  return parseRecipe(provider, input, session.locale);
}

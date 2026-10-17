import { HttpError } from "../../schemas/api";
import { RecipeParse } from "../../schemas/ai";
import type { Locale } from "../../schemas/settings";
import { guardOutput } from "../guard";
import type { AiProvider, CompleteResult } from "../types";
import { extractText, readJsonLd } from "./jsonld";
import { recipePrompt } from "./prompt";

/** One way in (plan §6): a fetched page, pasted text or a photo. The URL was fetched by the caller. */
export type RecipeInput =
  | { kind: "html"; html: string }
  | { kind: "text"; text: string }
  | { kind: "photo"; base64: string };

export interface ParsedRecipe {
  parse: RecipeParse;
  /** True when a model read the lines; false for JSON-LD, which no model touched. */
  approx: boolean;
}

function accept(result: CompleteResult): RecipeParse {
  if (result.kind !== "json") throw new HttpError(503, "ai-unavailable");
  const parsed = RecipeParse.safeParse(result.json);
  if (!parsed.success) throw new HttpError(422, "ai-rejected");
  guardOutput(parsed.data);
  return parsed.data;
}

/**
 * JSON-LD before the model, always (decision 10): a `schema.org/Recipe` page costs no call and
 * works with AI off (`provider: null`). Text and a page without JSON-LD go to `complete` with
 * `use: "recipe"`; a photo goes to `vision` as the plate estimate does. The provider is the
 * space's capped one, so every call counts against the daily cap.
 */
export async function parseRecipe(
  provider: AiProvider | null,
  input: RecipeInput,
  locale: Locale,
  options: { fallbackTitle?: string } = {},
): Promise<ParsedRecipe> {
  if (input.kind === "html") {
    const structured = readJsonLd(input.html, options);
    if (structured) return { parse: structured, approx: false };
    if (!provider) throw new HttpError(422, "recipe-unreadable");
    return { parse: await fromText(provider, extractText(input.html), locale), approx: true };
  }
  if (!provider) throw new HttpError(409, "ai-disabled");
  if (input.kind === "text")
    return { parse: await fromText(provider, input.text, locale), approx: true };
  const result = await provider.vision({
    role: "everyday",
    use: "recipe",
    system: recipePrompt(locale),
    prompt: "Read the recipe in this picture.",
    image: { mediaType: "image/jpeg", base64: input.base64 },
    outputSchema: RecipeParse,
  });
  return { parse: accept(result), approx: true };
}

async function fromText(provider: AiProvider, text: string, locale: Locale): Promise<RecipeParse> {
  if (!text.trim()) throw new HttpError(422, "recipe-unreadable");
  const result = await provider.complete({
    role: "everyday",
    use: "recipe",
    system: recipePrompt(locale),
    messages: [{ role: "user", content: [{ type: "text", text }] }],
    outputSchema: RecipeParse,
  });
  return accept(result);
}

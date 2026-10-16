import { isDeepStrictEqual } from "node:util";
import { HttpError } from "../../schemas/api";
import { ParsedMeal } from "../../schemas/ai";
import type { LookupResponse, LookupResult } from "../../schemas/food";
import type { Locale } from "../../schemas/settings";
import { runToolLoop } from "../tool-loop";
import type { AiProvider } from "../types";
import { parsePrompt } from "./prompt";
import { LookupInput, lookupTool } from "./tool";

export async function parseMeal(
  provider: AiProvider,
  text: string,
  locale: Locale,
  lookup: (query: string) => Promise<LookupResponse>,
  onToolCall: () => void = () => undefined,
): Promise<{ meal: ParsedMeal; count: number }> {
  let count = 0;
  const searched = new Map<string, LookupResult[]>();
  const key = (query: string) => query.trim().toLocaleLowerCase(locale);
  const result = await runToolLoop(
    provider,
    {
      role: "everyday",
      use: "parse",
      system: parsePrompt(locale),
      messages: [{ role: "user", content: [{ type: "text", text }] }],
      tools: [lookupTool],
      outputSchema: ParsedMeal,
    },
    {
      lookup: async (input) => {
        count++;
        onToolCall();
        const { query } = LookupInput.parse(input);
        const queryKey = key(query);
        if (!searched.has(queryKey)) searched.set(queryKey, []);
        const answer = await lookup(query);
        searched.get(queryKey)?.push(...answer.results);
        return answer;
      },
    },
    { maxCalls: 8 },
  );
  const parsed = ParsedMeal.safeParse(result.json);
  if (!parsed.success) throw new HttpError(502, "ai-rejected");
  // The model selects quantities; identities and nutrition must come from the actual lookup.
  for (const item of parsed.data.items) {
    const found = searched.get(key(item.query));
    if (!found) throw new HttpError(502, "ai-rejected");
    if (item.estimate) {
      if (found.length > 0) throw new HttpError(502, "ai-rejected");
      continue;
    }
    if (!item.match) throw new HttpError(502, "ai-rejected");
    const match = item.match;
    // Providers see JSON, which omits undefined optional properties from lookup rows.
    const original = found.find(
      (row) =>
        row.source === match.source &&
        isDeepStrictEqual(
          JSON.parse(JSON.stringify(row.food)),
          JSON.parse(JSON.stringify(match.food)),
        ),
    );
    if (!original) throw new HttpError(502, "ai-rejected");
  }
  for (const query of parsed.data.unmatched) {
    if (!searched.has(key(query))) throw new HttpError(502, "ai-rejected");
  }
  return { meal: parsed.data, count };
}

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
  const found: LookupResult[] = [];
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
        const answer = await lookup(query);
        found.push(...answer.results);
        return answer;
      },
    },
    { maxCalls: 8 },
  );
  const parsed = ParsedMeal.safeParse(result.json);
  if (!parsed.success) throw new HttpError(502, "ai-rejected");
  // The model selects quantities; identities and nutrition must come from the actual lookup.
  for (const item of parsed.data.items) {
    if (!item.match) continue;
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
  return { meal: parsed.data, count };
}

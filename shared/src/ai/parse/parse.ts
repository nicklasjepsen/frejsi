import { HttpError } from "../../schemas/api";
import { ParsedMeal, ParsedMealDraft } from "../../schemas/ai";
import type { LookupResponse, LookupResult } from "../../schemas/food";
import type { Locale } from "../../schemas/settings";
import { runToolLoop } from "../tool-loop";
import type { AiProvider } from "../types";
import { parsePrompt } from "./prompt";
import { LookupInput, lookupTool } from "./tool";

/** How the prompt tells the model to name a lookup row's food. */
const foodRef = (food: LookupResult["food"]) => ("id" in food ? food.id : food.sourceRef);

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
      outputSchema: ParsedMealDraft,
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
  const parsed = ParsedMealDraft.safeParse(result.json);
  if (!parsed.success) throw new HttpError(502, "ai-rejected");
  // The model selects quantities; identities and nutrition come from the actual lookup.
  const rows = [...searched.values()].flat();
  const items = parsed.data.items.map((item) => {
    if (item.estimate) {
      // An estimate is only for a food that this very lookup did not find.
      const found = searched.get(key(item.query));
      if (!found || found.length > 0) throw new HttpError(502, "ai-rejected");
      return { query: item.query, estimate: item.estimate };
    }
    if (!item.match) throw new HttpError(502, "ai-rejected");
    const { foodRef: ref, ...match } = item.match;
    // Any row lookup returned will do: "rugbrød" and "ost" can both find "rugbrød med ost", and
    // the nutrition is the row's whatever words the model searched with.
    const original = rows.find((row) => row.source === match.source && foodRef(row.food) === ref);
    if (!original) throw new HttpError(502, "ai-rejected");
    return { query: item.query, match: { ...match, food: original.food } };
  });
  for (const query of parsed.data.unmatched) {
    if (!searched.has(key(query))) throw new HttpError(502, "ai-rejected");
  }
  const meal = ParsedMeal.safeParse({ ...parsed.data, items });
  if (!meal.success) throw new HttpError(502, "ai-rejected");
  return { meal: meal.data, count };
}

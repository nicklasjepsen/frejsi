import { HttpError } from "../../schemas/api";
import { InsightInput, MealInsight } from "../../schemas/ai";
import { guardOutput } from "../guard";
import type { AiProvider } from "../types";
import { assertKnownNumbers, narrationInput, numerals } from "./numbers";
import { mealPrompt } from "./prompt-meal";

export async function narrateMeal(provider: AiProvider, raw: InsightInput) {
  const input = InsightInput.parse(raw);
  const projected = narrationInput(input);
  const allowed = new Set(numerals(projected));
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await provider.complete({
        role: "everyday",
        effort: "medium",
        use: "insight-meal",
        system: `${mealPrompt}${input.locale === "da" ? " Danish lead label: forspringet før måltidet." : ""}${attempt ? " Only literal observations and input numbers. No advice." : ""}`,
        outputSchema: MealInsight,
        maxTokens: 400,
        messages: [{ role: "user", content: [{ type: "text", text: JSON.stringify(projected) }] }],
      });
      if (result.kind !== "json") throw new HttpError(502, "ai-rejected");
      const parsed = MealInsight.safeParse(result.json);
      if (!parsed.success) throw new HttpError(502, "ai-rejected");
      guardOutput(parsed.data);
      assertKnownNumbers(parsed.data.text, allowed);
      return { ...parsed.data, model: result.model };
    } catch (error) {
      if (!(error instanceof HttpError) || error.code !== "ai-rejected" || attempt === 1)
        throw error;
    }
  }
  throw new HttpError(502, "ai-rejected");
}

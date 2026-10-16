import { fromMmol } from "../../index";
import { HttpError } from "../../schemas/api";
import { InsightInput, MealInsight } from "../../schemas/ai";
import { guardOutput } from "../guard";
import type { AiProvider } from "../types";
import { mealPrompt } from "./prompt-meal";

function numbers(value: unknown): number[] {
  if (typeof value === "number") return [value];
  if (typeof value === "string")
    return [...value.matchAll(/-?\d+(?:[.,]\d+)?/g)].map((m) => Number(m[0].replace(",", ".")));
  if (Array.isArray(value)) return value.flatMap(numbers);
  if (value && typeof value === "object") return Object.values(value).flatMap(numbers);
  return [];
}
export async function narrateMeal(provider: AiProvider, raw: InsightInput) {
  const input = InsightInput.parse(raw);
  const narrationInput =
    input.glucoseUnit === "mgdl"
      ? {
          ...input,
          displayPeakValues: [input.stats, ...input.previous.map((p) => p.stats)].flatMap(
            (stats) => (stats.peak ? [fromMmol(stats.peak.mmol, input.glucoseUnit)] : []),
          ),
        }
      : input;
  const allowed = new Set(numbers(narrationInput));
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await provider.complete({
        role: "everyday",
        effort: "medium",
        use: "insight-meal",
        system: `${mealPrompt}${input.locale === "da" ? " Danish lead label: forspringet før måltidet." : ""}${attempt ? " Only literal observations and input numbers. No advice." : ""}`,
        outputSchema: MealInsight,
        maxTokens: 400,
        messages: [
          { role: "user", content: [{ type: "text", text: JSON.stringify(narrationInput) }] },
        ],
      });
      if (result.kind !== "json") throw new HttpError(502, "ai-rejected");
      const parsed = MealInsight.safeParse(result.json);
      if (!parsed.success) throw new HttpError(502, "ai-rejected");
      guardOutput(parsed.data);
      if (numbers(parsed.data.text).some((n) => !allowed.has(n)))
        throw new HttpError(502, "ai-rejected");
      return { ...parsed.data, model: result.model };
    } catch (error) {
      if (!(error instanceof HttpError) || error.code !== "ai-rejected" || attempt === 1)
        throw error;
    }
  }
  throw new HttpError(502, "ai-rejected");
}

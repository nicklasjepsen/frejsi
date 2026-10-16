import { HttpError } from "../../schemas/api";
import { WeekInsight, WeekInsightInput } from "../../schemas/ai";
import { assertNoDosing } from "../guard";
import type { AiProvider } from "../types";
import { assertKnownNumbers, narrationInput, numerals } from "./numbers";
import { weekPrompt } from "./prompt-week";

export async function narrateWeek(provider: AiProvider, raw: WeekInsightInput) {
  const input = WeekInsightInput.parse(raw);
  const projected = narrationInput(input);
  const allowed = new Set(numerals(projected));
  for (let attempt = 0; attempt < 2; attempt++) {
    // Filter before the capped provider's recursive guard. Counting stays local rather
    // than adding bookkeeping fields to the model's WeekInsight output contract.
    let rejectedCount = 0;
    const output = WeekInsight.overwrite((value) => {
      const safe = value.questions.filter((question) => {
        try {
          assertNoDosing(question, "question");
          assertKnownNumbers(question, allowed);
          return true;
        } catch {
          return false;
        }
      });
      // The capped provider parses once and this service validates the returned object again.
      rejectedCount = Math.max(rejectedCount, value.questions.length - safe.length);
      return { summary: value.summary, questions: safe };
    });
    try {
      const result = await provider.complete({
        role: "insight",
        effort: "medium",
        use: "insight-week",
        system: `${weekPrompt}${input.locale === "da" ? " Danish lead label: forspringet før måltidet." : ""}${attempt ? " Only literal observations and input numbers. No advice." : ""}`,
        outputSchema: output,
        maxTokens: 1400,
        messages: [{ role: "user", content: [{ type: "text", text: JSON.stringify(projected) }] }],
      });
      if (result.kind !== "json") throw new HttpError(502, "ai-rejected");
      const parsed = output.safeParse(result.json);
      if (!parsed.success) throw new HttpError(502, "ai-rejected");
      assertNoDosing(parsed.data.summary, "summary");
      assertKnownNumbers(parsed.data.summary, allowed);
      return { ...parsed.data, rejectedCount, model: result.model };
    } catch (error) {
      if (!(error instanceof HttpError) || error.code !== "ai-rejected" || attempt === 1)
        throw error;
    }
  }
  throw new HttpError(502, "ai-rejected");
}

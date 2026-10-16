import { z } from "zod";
import { HttpError } from "../../schemas/api";
import { WeekInsight, WeekInsightInput } from "../../schemas/ai";
import { assertNoDosing } from "../guard";
import type { AiProvider } from "../types";
import { weekPrompt } from "./prompt-week";

// Transform before the capped provider's recursive guard: unsafe questions are discarded,
// while a failed summary still rejects the whole attempt and is counted by the wrapper.
const output = WeekInsight.extend({
  rejectedCount: z.number().int().nonnegative().default(0),
}).overwrite((value) => {
  const safe = value.questions.filter((question) => {
    try {
      assertNoDosing(question, "question");
      return true;
    } catch {
      return false;
    }
  });
  return {
    summary: value.summary,
    questions: safe,
    rejectedCount: value.rejectedCount + value.questions.length - safe.length,
  };
});
const accepted = WeekInsight.extend({ rejectedCount: z.number().int().nonnegative() });
export async function narrateWeek(provider: AiProvider, raw: WeekInsightInput) {
  const input = WeekInsightInput.parse(raw);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await provider.complete({
        role: "insight",
        effort: "medium",
        use: "insight-week",
        system: `${weekPrompt}${input.locale === "da" ? " Danish lead label: forspringet før måltidet." : ""}${attempt ? " Only literal observations. No advice." : ""}`,
        outputSchema: output,
        maxTokens: 1400,
        messages: [{ role: "user", content: [{ type: "text", text: JSON.stringify(input) }] }],
      });
      if (result.kind !== "json") throw new HttpError(502, "ai-rejected");
      const parsed = accepted.safeParse(result.json);
      // A bare interface fake may return the original object; production returns the transform.
      const data = parsed.success ? parsed.data : output.parse(result.json);
      assertNoDosing(data.summary, "summary");
      return { ...data, model: result.model };
    } catch (error) {
      if (!(error instanceof HttpError) || error.code !== "ai-rejected" || attempt === 1)
        throw error;
    }
  }
  throw new HttpError(502, "ai-rejected");
}

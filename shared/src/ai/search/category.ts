import { z } from "zod";
import { FoodCategory } from "../../schemas/food";
import type { Locale } from "../../schemas/settings";
import type { AiProvider } from "../types";
import { CATEGORY_PROMPT } from "./prompt";

/** The model's whole answer: one of the ten categories and nothing else. */
export const FoodCategoryAnswer = z.strictObject({ category: FoodCategory });
export type FoodCategoryAnswer = z.infer<typeof FoodCategoryAnswer>;

/**
 * The category of a food by name (v0.6.0 plan §7): a small call under the normalise cap. Only
 * the name reaches the model; a failed, capped or off-schema answer is null and the row keeps
 * waiting for the next run.
 */
export async function categoriseFood(
  provider: AiProvider,
  name: string,
  locale: Locale,
): Promise<FoodCategory | null> {
  try {
    const result = await provider.complete({
      role: "small",
      use: "normalise",
      system: CATEGORY_PROMPT,
      messages: [
        { role: "user", content: [{ type: "text", text: JSON.stringify({ name, locale }) }] },
      ],
      outputSchema: FoodCategoryAnswer,
    });
    if (result.kind !== "json") return null;
    const answer = FoodCategoryAnswer.safeParse(result.json);
    return answer.success ? answer.data.category : null;
  } catch {
    return null;
  }
}

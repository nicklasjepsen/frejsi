import { NormalisedFood } from "../../schemas/ai";
import type { Locale } from "../../schemas/settings";
import type { AiProvider } from "../types";
import { NORMALISE_FOOD_PROMPT } from "./prompt";
export async function normaliseFoodName(
  provider: AiProvider,
  name: string,
  locale: Locale,
): Promise<NormalisedFood | null> {
  try {
    const result = await provider.complete({
      role: "small",
      use: "normalise",
      system: NORMALISE_FOOD_PROMPT,
      messages: [
        { role: "user", content: [{ type: "text", text: JSON.stringify({ name, locale }) }] },
      ],
      outputSchema: NormalisedFood,
    });
    return result.kind === "json" ? NormalisedFood.parse(result.json) : null;
  } catch {
    return null;
  }
}

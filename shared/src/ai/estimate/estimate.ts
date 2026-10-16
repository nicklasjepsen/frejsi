import { HttpError } from "../../schemas/api";
import { PhotoEstimate } from "../../schemas/ai";
import type { Locale } from "../../schemas/settings";
import { guardOutput } from "../guard";
import type { AiProvider } from "../types";
import { estimatePrompt } from "./prompt";

export async function estimatePhoto(
  provider: AiProvider,
  base64: string,
  locale: Locale,
): Promise<PhotoEstimate> {
  const result = await provider.vision({
    role: "everyday",
    use: "estimate",
    system: estimatePrompt(locale),
    prompt: "Describe the food on this plate.",
    image: { mediaType: "image/jpeg", base64 },
    outputSchema: PhotoEstimate,
  });
  if (result.kind !== "json") throw new HttpError(503, "ai-unavailable");
  const parsed = PhotoEstimate.safeParse(result.json);
  if (!parsed.success) throw new HttpError(422, "ai-rejected");
  guardOutput(parsed.data);
  if (parsed.data.totalCarbs !== parsed.data.items.reduce((sum, item) => sum + item.carbs, 0))
    throw new HttpError(422, "ai-rejected");
  return parsed.data;
}

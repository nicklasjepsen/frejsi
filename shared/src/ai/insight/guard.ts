import { HttpError } from "../../schemas/api";
import phrases from "./symptom-explanations.json";

/**
 * A symptom is logged, never explained (v0.6.0 plan §5). A narration that gives a symptom a cause
 * or makes it a sign of something is refused the way dosing words are (`assertNoDosing`). The
 * phrases are data in `symptom-explanations.json`, one list per language, matched at a word start
 * and case-insensitively; code here stays English.
 */
export const SYMPTOM_EXPLANATION_PHRASES: readonly string[] = [...phrases.en, ...phrases.da];

const explanation = new RegExp(
  String.raw`(?<![\p{L}\p{N}_])(?:${SYMPTOM_EXPLANATION_PHRASES.map((phrase) =>
    phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  ).join("|")})`,
  "iu",
);

export function findSymptomExplanation(text: string): string | null {
  const match = explanation.exec(text.normalize("NFKC"));
  return match ? match[0] : null;
}

/** `where` names the field for a reader of the stack; the response carries only the code. */
export function assertNoSymptomExplanation(text: string, _where: string): void {
  if (findSymptomExplanation(text) !== null) throw new HttpError(502, "ai-rejected");
}

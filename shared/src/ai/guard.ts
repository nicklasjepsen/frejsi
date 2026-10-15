import { findDosingVocabulary } from "../dosing-vocabulary";
import { HttpError } from "../schemas/api";

/** The prefix prevents the UI-only whole-string allow-list from applying to generated text. */
export function assertNoDosing(text: string, where: string): void {
  if (findDosingVocabulary([[where, `Generated text: ${text}`]]).length > 0) {
    throw new HttpError(502, "ai-rejected");
  }
}

export function guardOutput(value: unknown): void {
  if (typeof value === "string") assertNoDosing(value, "output");
  else if (Array.isArray(value)) value.forEach(guardOutput);
  else if (value !== null && typeof value === "object") Object.values(value).forEach(guardOutput);
}

import { findDosingVocabulary } from "../dosing-vocabulary";
import { HttpError } from "../schemas/api";

// Generated narration is observational. These are the inherited copy-test verbs, plus the
// Danish imperative, and numeric unit expressions that need no named substance to be unsafe.
const directive =
  /(?<![\p{L}\p{N}_])(bør|skal|should|take|give|giv|tag|inject|injicer|administer|administrer|næste gang|next time)(?![\p{L}\p{N}_])/iu;
const amount = String.raw`(?:\p{N}+(?:[.,]\p{N}+)?|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|half|quarter|(?:nul|en|et|én|ét|to|tre|fire|fem|seks|syv|otte|ni|ti|elleve|tolv|tretten|fjorten|femten|seksten|sytten|atten|nitten|tyve|tredive|fyrre|halvtreds|tres|halvfjerds|firs|halvfems|hundrede|tusind|halv|kvart)(?:og(?:tyve|tredive|fyrre|halvtreds|tres|halvfjerds|firs|halvfems))?)`;
const numericUnit = new RegExp(
  String.raw`(?<![\p{L}\p{N}_])(?:units?|enhed(?:er)?|${amount}[\s\p{P}\p{S}]*[ue])(?![\p{L}\p{N}_])`,
  "iu",
);

/** The prefix prevents the UI-only whole-string allow-list from applying to generated text. */
export function assertNoDosing(text: string, where: string): void {
  const normalized = text.normalize("NFKC");
  if (
    findDosingVocabulary([[where, `Generated text: ${text}`]]).length > 0 ||
    findDosingVocabulary([[where, `Generated text: ${normalized}`]]).length > 0 ||
    directive.test(normalized) ||
    numericUnit.test(normalized)
  ) {
    throw new HttpError(502, "ai-rejected");
  }
}

export function guardOutput(value: unknown): void {
  if (typeof value === "string") assertNoDosing(value, "output");
  else if (Array.isArray(value)) value.forEach(guardOutput);
  else if (value !== null && typeof value === "object") Object.values(value).forEach(guardOutput);
}

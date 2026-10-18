import { z } from "zod";

/**
 * The hard rule in test form (plan §8, restated in v0.7.0 plan §7): Frejsi never computes,
 * suggests or lets anyone enter insulin. These words and phrases must not appear in UI strings,
 * in the keys of any exported Zod schema, or (from v0.4.0) in generated insight text. The bare
 * words `enhed`/`units` are not listed because here they mean devices and the glucose unit.
 *
 * The one exception is pump history (v0.7.0): the time and delivered units of a bolus the pump
 * recorded, shown in the pump-history files only (`PUMP_HISTORY_FILES` and `shared/src/pump/
 * messages/`). There the word `bolus` and a unit amount pass, every other dosing word still fails,
 * and the suggestion vocabulary fails too. AI output never gets the exception.
 */
export const DOSING_WORDS = [
  "insulin",
  "dosis",
  "dose",
  "dosing",
  "ratio",
  "correction",
  "korrektion",
  "ICR",
  "ISF",
  "IE",
  "IU",
  "bolus",
  "enheder insulin",
  "insulin units",
  "units of insulin",
] as const;

/**
 * Exactly these strings pass, plus the pattern `Bolus HH:MM`; nothing else. Each Danish string has
 * its English counterpart so `en.json` can carry the same copy (plan §8, amended for the long
 * sentence, which the plan listed in Danish only).
 */
export const DOSING_ALLOW_LIST = [
  "regner aldrig insulin",
  "Frejsi · åben kildekode · regner aldrig insulin",
  "Frejsi er åben kildekode, regner aldrig insulin og erstatter ikke din sensor-app eller pumpe-app.",
  "never calculates insulin",
  "Frejsi · open source · never calculates insulin",
  "Frejsi is open source, never calculates insulin and does not replace your sensor app or pump app.",
  "Bolus givet nu",
  "Bolus før måltid",
  "bolus given now",
  "bolus before meal",
] as const;

/**
 * v0.3.0 (plan §9, task 3): the labels the meal curve, the stat tiles and the tables draw, each its
 * own message key and matched as a whole string. In order: `da` "Bolus" (the tile label), "Bolus
 * før" (the table header), "Bolus givet" (the day-curve legend); `en` "Bolus", "Bolus before",
 * "Bolus given", "Bolus before meal" (the week tile; the lowercase v0.1.0 entry does not match it).
 * "Bolus" appears once per locale on purpose, so the list reads as the plan enumerates it.
 * "Bolus 11:58" is the `Bolus {time}` pattern below; "Bolus før måltid" is already on the v0.1.0 list.
 */
export const MEAL_CURVE_ALLOW_LIST = [
  "Bolus",
  "Bolus før",
  "Bolus givet",
  "Bolus",
  "Bolus before",
  "Bolus given",
  "Bolus before meal",
] as const;

/** `Bolus HH:MM`, rendered or as its message template `Bolus {time}` (the `log.bolus.at` key). */
export const BOLUS_TIME = /^Bolus (?:\d{2}:\d{2}|\{time\})$/;

/**
 * The message files that show pump history (v0.7.0 plan §7), in either locale; `shared/src/pump/
 * messages/` is scanned with the same scope. Only there may a unit amount and the word `bolus`
 * appear; every other dosing word and every suggestion word still fails in them.
 */
export const PUMP_HISTORY_FILES = ["pump.json", "pumpMeal.json", "pumpSettings.json"] as const;

/** True for `da/pump.json`, `web/messages/en/pumpMeal.json`, `pump/messages/da.json` and the like. */
export function isPumpHistoryFile(where: string): boolean {
  const file = where.split(":")[0] ?? where;
  const name = file.split("/").pop() ?? file;
  return (
    (PUMP_HISTORY_FILES as readonly string[]).includes(name) ||
    /(?:^|\/)pump\/messages\/[a-z]{2}\.json$/.test(file)
  );
}

/**
 * Words that turn a number into advice (v0.7.0 plan §7). They fail in the pump-history files and in
 * every schema key and enum value. A trailing `*` matches the stem by prefix (`anbefal*` matches
 * "anbefalet"); everything else is a whole word or phrase.
 */
export const SUGGESTION_WORDS = [
  "bør",
  "burde",
  "skal tage",
  "anbefal*",
  "foreslå*",
  "beregn*",
  "udregn*",
  "giv",
  "tag",
  "næste gang",
  "should",
  "recommend*",
  "suggest*",
  "calculat*",
  "compute*",
  "give",
  "take",
  "next time",
] as const;

/**
 * A number, an ICU `#` or a `{…}` placeholder followed by a unit word: "2 E", "{count} enheder",
 * "# units". Fails in every message file outside the pump-history files and in the push copy, so
 * an amount of insulin cannot appear anywhere but pump history. Device copy says "apparater".
 */
export const UNIT_AMOUNT =
  /(?<![\p{L}\p{N}_])(?:\p{N}+(?:[.,]\p{N}+)?|\{[^{}]*\}|#)\s*(?:E|U|IE|IU|[Ee]nhed(?:er)?|[Uu]nits?)(?![\p{L}\p{N}_])/u;

export interface DosingFinding {
  where: string;
  text: string;
  term: (typeof DOSING_WORDS)[number];
}

export interface SuggestionFinding {
  where: string;
  text: string;
  term: (typeof SUGGESTION_WORDS)[number];
}

export interface UnitAmountFinding {
  where: string;
  text: string;
  /** The amount and unit as written, "2 E". */
  amount: string;
}

/** What a pump-history file may not say: a finding of either kind. */
export type PumpCopyFinding = DosingFinding | SuggestionFinding;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Unicode-aware word boundaries so "insulinpumpe" and "rationel" do not match but "Insulin" does.
const wordBounded = (term: string, stem = false) =>
  new RegExp(
    `(?<![\\p{L}\\p{N}_])${escape(term)}${stem ? "\\p{L}*" : ""}(?![\\p{L}\\p{N}_])`,
    "iu",
  );
const patterns = DOSING_WORDS.map((term) => ({ term, re: wordBounded(term) }));
/** In pump history the word `bolus` is lifted; nothing else is. */
const pumpPatterns = patterns.filter(({ term }) => term !== "bolus");
const suggestionPatterns = SUGGESTION_WORDS.map((term) => ({
  term,
  re: term.endsWith("*") ? wordBounded(term.slice(0, -1), true) : wordBounded(term),
}));

function isAllowed(text: string): boolean {
  return (
    (DOSING_ALLOW_LIST as readonly string[]).includes(text) ||
    (MEAL_CURVE_ALLOW_LIST as readonly string[]).includes(text) ||
    BOLUS_TIME.test(text)
  );
}

/** Every listed term found in each `[where, text]` pair that is not on the allow-list. */
export function findDosingVocabulary(
  strings: Iterable<readonly [string, string]>,
): DosingFinding[] {
  const findings: DosingFinding[] = [];
  for (const [where, text] of strings) {
    if (isAllowed(text)) continue;
    for (const { term, re } of patterns) {
      if (re.test(text)) findings.push({ where, text, term });
    }
  }
  return findings;
}

/** Every suggestion word found in each `[where, text]` pair; no allow-list applies. */
export function findSuggestionVocabulary(
  strings: Iterable<readonly [string, string]>,
): SuggestionFinding[] {
  const findings: SuggestionFinding[] = [];
  for (const [where, text] of strings) {
    for (const { term, re } of suggestionPatterns) {
      if (re.test(text)) findings.push({ where, text, term });
    }
  }
  return findings;
}

/** Every unit amount ("2 E", "{count} enheder", "# units") in each `[where, text]` pair. */
export function findUnitAmounts(strings: Iterable<readonly [string, string]>): UnitAmountFinding[] {
  const findings: UnitAmountFinding[] = [];
  for (const [where, text] of strings) {
    const match = UNIT_AMOUNT.exec(text);
    if (match) findings.push({ where, text, amount: match[0] });
  }
  return findings;
}

/**
 * The pump-history scope (v0.7.0 plan §7): every dosing word but `bolus`, and every suggestion
 * word, with no allow-list. A unit amount passes here and nowhere else.
 */
export function findPumpCopyVocabulary(
  strings: Iterable<readonly [string, string]>,
): PumpCopyFinding[] {
  const findings: PumpCopyFinding[] = [];
  const list = [...strings];
  for (const [where, text] of list) {
    for (const { term, re } of pumpPatterns) {
      if (re.test(text)) findings.push({ where, text, term });
    }
  }
  return [...findings, ...findSuggestionVocabulary(list)];
}

/**
 * The keys an AI input may never carry (v0.7.0 plan §7): the pump record stays out of every model
 * input. `units`, `bolusUnits`, `pumpCarbs`, anything starting with `pump`, and `carbs` under a
 * pump field. Walk `InsightInput` and `WeekInsightInput` with `schemaVocabulary` first.
 */
export function findPumpFieldsInAiInput(
  vocabulary: Iterable<readonly [string, string]>,
): [string, string][] {
  const out: [string, string][] = [];
  for (const [where, key] of vocabulary) {
    if (key === "units" || key === "bolusUnits" || key === "pumpCarbs" || /^pump/i.test(key))
      out.push([where, key]);
    else if (key === "carbs" && /\.pump/i.test(where)) out.push([where, key]);
  }
  return out;
}

/** Flattens `{ "da.json": { nested } }` into `[ "da.json:path.to.key", string ]` pairs. */
export function messageStrings(files: Record<string, unknown>): [string, string][] {
  const out: [string, string][] = [];
  const walk = (prefix: string, value: unknown) => {
    if (typeof value === "string") {
      out.push([prefix, value]);
    } else if (Array.isArray(value)) {
      value.forEach((item, index) => {
        walk(`${prefix}.${index}`, item);
      });
    } else if (typeof value === "object" && value !== null) {
      for (const [key, item] of Object.entries(value)) {
        walk(prefix.endsWith(":") ? `${prefix}${key}` : `${prefix}.${key}`, item);
      }
    }
  };
  for (const [file, content] of Object.entries(files)) walk(`${file}:`, content);
  return out;
}

/** Every object key and enum value reachable from each exported Zod schema in `exports`. */
export function schemaVocabulary(exports: Record<string, unknown>): [string, string][] {
  const out: [string, string][] = [];
  const seen = new Set<z.ZodType>();
  const walk = (where: string, schema: z.ZodType) => {
    if (seen.has(schema)) return;
    seen.add(schema);
    if (schema instanceof z.ZodObject) {
      for (const [key, child] of Object.entries<unknown>(schema.shape)) {
        out.push([`${where}.${key}`, key]);
        if (child instanceof z.ZodType) walk(`${where}.${key}`, child);
      }
    } else if (schema instanceof z.ZodEnum) {
      for (const value of schema.options) out.push([where, String(value)]);
    } else if (schema instanceof z.ZodLiteral) {
      for (const value of schema.values) out.push([where, String(value)]);
    } else if (schema instanceof z.ZodUnion || schema instanceof z.ZodDiscriminatedUnion) {
      const options: readonly unknown[] = schema.options;
      options.forEach((option, index) => {
        if (option instanceof z.ZodType) walk(`${where}[${index}]`, option);
      });
    } else if (schema instanceof z.ZodArray) {
      const element: unknown = schema.element;
      if (element instanceof z.ZodType) walk(`${where}[]`, element);
    } else if (
      schema instanceof z.ZodOptional ||
      schema instanceof z.ZodNullable ||
      schema instanceof z.ZodDefault
    ) {
      const inner: unknown = schema.unwrap();
      if (inner instanceof z.ZodType) walk(where, inner);
    } else if (schema instanceof z.ZodPipe) {
      const input: unknown = schema.in;
      const output: unknown = schema.out;
      if (input instanceof z.ZodType) walk(where, input);
      if (output instanceof z.ZodType) walk(where, output);
    }
  };
  for (const [name, value] of Object.entries(exports)) {
    if (value instanceof z.ZodType) walk(name, value);
    else if (typeof value === "object" && value !== null) {
      for (const [key, child] of Object.entries(value)) {
        if (child instanceof z.ZodType) walk(`${name}.${key}`, child);
      }
    }
  }
  return out;
}

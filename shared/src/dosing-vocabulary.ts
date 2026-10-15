import { z } from "zod";

/**
 * The hard rule in test form (plan §8): these words and phrases must not appear in UI strings,
 * in the keys of any exported Zod schema, or (from v0.4.0) in generated insight text. The bare
 * words `enhed`/`units` are not listed because here they mean devices and the glucose unit.
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
 * v0.2.0 (plan §8, task 7): the sentence drawn under "Bolus givet nu" on Log-Portioner and its
 * English counterpart, exactly as quoted in the plan. Kept apart from the v0.1.0 list above so that
 * list stays as its own test pins it.
 */
export const BOLUS_TAP_ALLOW_LIST = [
  '"Bolus givet nu" gemmer kun tidspunktet, så det kan ses på kurven. Frejsi regner aldrig insulin.',
  '"Bolus given now" saves only the time so it can be seen on the curve. Frejsi never calculates insulin.',
] as const;

/**
 * v0.3.0 (plan §9, task 3): the labels the meal curve, the stat tiles and the tables draw, each its
 * own message key and matched as a whole string. In order: `da` "Bolus" (the tile label), "Bolus
 * før" (the table header), "Bolus givet" (the day-curve legend); `en` "Bolus", "Bolus before",
 * "Bolus given", "Bolus before meal" (the week tile; the lowercase v0.1.0 entry does not match it).
 * "Bolus" appears once per locale on purpose, so the list reads as the plan enumerates it.
 * "Bolus 11:58" stays the BolusTap template below; "Bolus før måltid" is already on the v0.1.0 list.
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

/** `Bolus HH:MM`, rendered or as its message template `Bolus {time}` (the BolusTap key). */
const BOLUS_TIME = /^Bolus (?:\d{2}:\d{2}|\{time\})$/;

export interface DosingFinding {
  where: string;
  text: string;
  term: (typeof DOSING_WORDS)[number];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Unicode-aware word boundaries so "insulinpumpe" and "rationel" do not match but "Insulin" does.
const patterns = DOSING_WORDS.map((term) => ({
  term,
  re: new RegExp(`(?<![\\p{L}\\p{N}_])${escape(term)}(?![\\p{L}\\p{N}_])`, "iu"),
}));

function isAllowed(text: string): boolean {
  return (
    (DOSING_ALLOW_LIST as readonly string[]).includes(text) ||
    (BOLUS_TAP_ALLOW_LIST as readonly string[]).includes(text) ||
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

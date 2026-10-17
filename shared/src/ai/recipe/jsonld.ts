import type { RecipeParse } from "../../schemas/ai";
import { RecipeParse as RecipeParseSchema } from "../../schemas/ai";
import units from "./data/units.json";

/** The stripped page the model reads when there is no JSON-LD (plan §6): at most this long. */
export const MAX_PAGE_TEXT = 12_000;
const MAX_LINES = 40;
const NAME_LENGTH = 120;

interface Unit {
  unit: string;
  aliases: string[];
  grams?: number;
}
const UNITS: Unit[] = units;
const unitByAlias = new Map<string, Unit>();
for (const unit of UNITS)
  for (const alias of unit.aliases) unitByAlias.set(alias.toLowerCase().replace(/\.$/, ""), unit);

/** The canonical unit for a token the line carries, or null when the token is part of the name. */
export function canonicalUnit(token: string): Unit | null {
  return unitByAlias.get(token.toLowerCase().replace(/\.$/, "")) ?? null;
}

const VULGAR: Record<string, number> = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3 };
const NUMBER = String.raw`(?:\d+(?:[.,]\d+)?|[½¼¾⅓⅔])`;
// "1 1/2", "1/2", "1,5", "2.5", "½", "2-3" (the first of a range), optionally after "ca."
const AMOUNT = new RegExp(
  String.raw`^(?:(?:ca\.?|approx\.?|about|omkring)\s+)?(${NUMBER})(?:\s*[-–]\s*${NUMBER})?(?:\s+(\d+)\/(\d+)|\/(\d+))?\s*`,
  "iu",
);

function toNumber(token: string): number {
  const vulgar = VULGAR[token];
  if (vulgar !== undefined) return vulgar;
  return Number(token.replace(",", "."));
}

function cleanName(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, NAME_LENGTH).trim();
}

/** "500 g hakket oksekød" → name, amount and unit; a line that is only a name keeps the name. */
export function parseIngredientLine(line: string): RecipeParse["ingredients"][number] | null {
  const text = line.replace(/\s+/g, " ").trim();
  if (!text) return null;
  const match = AMOUNT.exec(text);
  if (!match) {
    const name = cleanName(text);
    return name ? { name } : null;
  }
  const [, whole = "", numerator, denominator, bareDenominator] = match;
  let amount = toNumber(whole);
  if (numerator && denominator) amount += Number(numerator) / Number(denominator);
  else if (bareDenominator) amount = amount / Number(bareDenominator);
  let rest = text.slice(match[0].length);
  if (!Number.isFinite(amount) || !rest.trim()) {
    const name = cleanName(text);
    return name ? { name } : null;
  }
  amount = Math.round(amount * 100) / 100;
  const [token = "", ...words] = rest.split(" ");
  const unit = canonicalUnit(token);
  if (unit && words.length > 0) rest = words.join(" ");
  const name = cleanName(rest);
  if (!name) return null;
  return unit && words.length > 0 ? { name, amount, unit: unit.unit } : { name, amount };
}

/** "6 portioner", "Til 4 personer", "12 stk", "1,2 kg" → portions or grams. */
export function parseYield(value: string): Pick<RecipeParse, "yieldPortions" | "yieldGrams"> {
  const text = value.replace(/\s+/g, " ").trim();
  const found = new RegExp(String.raw`(${NUMBER})\s*([\p{L}]+)?`, "u").exec(text);
  if (!found) return {};
  const amount = toNumber(found[1] ?? "");
  if (!Number.isFinite(amount) || amount <= 0) return {};
  const unit = found[2] ? canonicalUnit(found[2]) : null;
  if (unit?.grams !== undefined) {
    const grams = Math.round(amount * unit.grams);
    return grams >= 1 && grams <= 100_000 ? { yieldGrams: grams } : {};
  }
  return amount >= 0.5 && amount <= 1000 ? { yieldPortions: amount } : {};
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null;

function* recipeNodes(value: unknown): Generator<Json> {
  if (Array.isArray(value)) {
    for (const item of value) yield* recipeNodes(item);
    return;
  }
  if (!isObject(value)) return;
  const type = value["@type"];
  const types = Array.isArray(type) ? type : [type];
  if (types.includes("Recipe")) yield value;
  if ("@graph" in value) yield* recipeNodes(value["@graph"]);
}

function readYield(value: unknown): Pick<RecipeParse, "yieldPortions" | "yieldGrams"> {
  if (typeof value === "number") return parseYield(String(value));
  if (typeof value === "string") return parseYield(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const read = readYield(item);
      if (read.yieldPortions !== undefined || read.yieldGrams !== undefined) return read;
    }
  }
  return {};
}

const SCRIPT = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

/**
 * The `schema.org/Recipe` in a page's `application/ld+json`, read into a `RecipeParse` with no
 * model call (decision 10). Null when the page has none that parses.
 */
export function readJsonLd(html: string): RecipeParse | null {
  for (const match of html.matchAll(SCRIPT)) {
    let json: unknown;
    try {
      json = JSON.parse(decodeEntities(match[1] ?? "").trim() ? (match[1] ?? "") : "");
    } catch {
      continue;
    }
    for (const node of recipeNodes(json)) {
      const lines = Array.isArray(node.recipeIngredient) ? node.recipeIngredient : [];
      const ingredients = lines
        .filter((line): line is string => typeof line === "string")
        .map(parseIngredientLine)
        .filter((line): line is NonNullable<typeof line> => line !== null)
        .slice(0, MAX_LINES);
      const title = typeof node.name === "string" ? cleanName(node.name) : "";
      const candidate = {
        title: title || "Opskrift",
        ingredients,
        ...readYield(node.recipeYield),
      };
      const parsed = RecipeParseSchema.safeParse(candidate);
      if (parsed.success) return parsed.data;
    }
  }
  return null;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  aelig: "æ",
  oslash: "ø",
  aring: "å",
  AElig: "Æ",
  Oslash: "Ø",
  Aring: "Å",
  eacute: "é",
  uuml: "ü",
  ouml: "ö",
  auml: "ä",
};
function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X"))
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number(entity.slice(1)));
    return ENTITIES[entity] ?? whole;
  });
}

/** The page as the model reads it: no tags, scripts or styles, one space between words, capped. */
export function extractText(html: string): string {
  const text = html
    .replace(/<(script|style|noscript|svg|template)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|br|section|article|header|footer|nav)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(text).replace(/\s+/g, " ").trim().slice(0, MAX_PAGE_TEXT).trim();
}

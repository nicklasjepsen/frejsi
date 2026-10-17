import type { RecipeParse } from "../../schemas/ai";
import { RecipeParse as RecipeParseSchema } from "../../schemas/ai";
import entities from "./data/entities.json";
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

/**
 * Every `<script type="application/ld+json">` body, found by scanning (indexOf, never a regex
 * over the whole page: a page is attacker-shaped input and must read in linear time).
 */
function jsonLdBlocks(html: string): string[] {
  const lower = html.toLowerCase();
  const blocks: string[] = [];
  let from = 0;
  for (;;) {
    const open = lower.indexOf("<script", from);
    if (open === -1) return blocks;
    const tagEnd = lower.indexOf(">", open);
    if (tagEnd === -1) return blocks;
    const close = lower.indexOf("</script", tagEnd);
    if (close === -1) return blocks;
    const attributes = lower.slice(open + "<script".length, tagEnd);
    if (attributes.includes("application/ld+json")) blocks.push(html.slice(tagEnd + 1, close));
    from = close + "</script".length;
  }
}

/** The page's own `<title>`, the fallback for a Recipe without a name. */
function pageTitle(html: string): string {
  const lower = html.toLowerCase();
  const open = lower.indexOf("<title");
  if (open === -1) return "";
  const tagEnd = lower.indexOf(">", open);
  const close = lower.indexOf("</title", tagEnd);
  if (tagEnd === -1 || close === -1) return "";
  return cleanName(decodeEntities(html.slice(tagEnd + 1, close)));
}

export function readJsonLd(
  html: string,
  options: { fallbackTitle?: string } = {},
): RecipeParse | null {
  for (const block of jsonLdBlocks(html)) {
    let json: unknown;
    try {
      json = JSON.parse(block);
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
        title:
          [title, pageTitle(html), options.fallbackTitle?.trim()].find((value) => value) ??
          "Recipe",
        ingredients,
        ...readYield(node.recipeYield),
      };
      const parsed = RecipeParseSchema.safeParse(candidate);
      if (parsed.success) return parsed.data;
    }
  }
  return null;
}

const ENTITIES: Record<string, string> = entities;
function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X"))
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number(entity.slice(1)));
    return ENTITIES[entity] ?? whole;
  });
}

const SKIPPED = new Set(["script", "style", "noscript", "svg", "template"]);
const BREAKS = new Set([
  "p",
  "div",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "tr",
  "br",
  "section",
  "article",
  "header",
  "footer",
  "nav",
]);

/**
 * The page as the model reads it: no tags, scripts or styles, one space between words, capped.
 * A single pass with indexOf: the page is untrusted input and must strip in linear time.
 */
export function extractText(html: string): string {
  const lower = html.toLowerCase();
  let out = "";
  let at = 0;
  while (at < html.length) {
    const open = html.indexOf("<", at);
    if (open === -1) {
      out += html.slice(at);
      break;
    }
    out += html.slice(at, open);
    if (html.startsWith("<!--", open)) {
      const end = html.indexOf("-->", open + 4);
      at = end === -1 ? html.length : end + 3;
      out += " ";
      continue;
    }
    const tagEnd = html.indexOf(">", open);
    if (tagEnd === -1) break;
    const tag = /^<\/?([a-z0-9]+)/i.exec(html.slice(open, Math.min(tagEnd + 1, open + 40)));
    const name = tag?.[1]?.toLowerCase() ?? "";
    const closing = html.startsWith("</", open);
    if (!closing && SKIPPED.has(name)) {
      const end = lower.indexOf(`</${name}`, tagEnd);
      const after = end === -1 ? html.length : lower.indexOf(">", end);
      at = after === -1 ? html.length : after + 1;
      out += " ";
      continue;
    }
    out += closing && BREAKS.has(name) ? "\n" : " ";
    at = tagEnd + 1;
  }
  return decodeEntities(out).replace(/\s+/g, " ").trim().slice(0, MAX_PAGE_TEXT).trim();
}

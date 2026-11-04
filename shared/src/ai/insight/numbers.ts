import { fromMmol } from "../../index";
import type { InsightInput, WeekInsightInput } from "../../schemas/ai";
import { HttpError } from "../../schemas/api";

export function numerals(value: unknown): number[] {
  if (typeof value === "number") return [value];
  if (typeof value === "string")
    return [...value.matchAll(/-?\d+(?:[.,]\d+)?/g)].map((m) => Number(m[0].replace(",", ".")));
  if (Array.isArray(value)) return value.flatMap(numerals);
  if (value && typeof value === "object") return Object.values(value).flatMap(numerals);
  return [];
}
export function unknownNumbers(text: string, allowed: ReadonlySet<number>): number[] {
  return numerals(text).filter((n) => !allowed.has(n));
}
export function assertKnownNumbers(text: string, allowed: ReadonlySet<number>): void {
  if (unknownNumbers(text, allowed).length > 0) throw new HttpError(502, "ai-rejected");
}
export function narrationInput(input: InsightInput | WeekInsightInput) {
  if (input.glucoseUnit !== "mgdl") return input;
  const stats =
    "stats" in input ? [input.stats, ...input.previous.map((p) => p.stats)] : input.meals;
  return {
    ...input,
    displayPeakValues: stats.flatMap((row) =>
      row.peak ? [fromMmol(row.peak.mmol, input.glucoseUnit)] : [],
    ),
  };
}

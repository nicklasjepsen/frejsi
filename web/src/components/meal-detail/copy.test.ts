// The copy test of plan §9 on `mealDetail.*`: the screen describes what happened and never tells
// anyone what to do, and no string of its own contains "bolus" (the bolus tile, legend and marker
// reuse the allowed `stats.*`, `chart.*` and `log.bolus.at` keys). Word-bounded, case-insensitive.
import { findPumpCopyVocabulary, findSuggestionVocabulary } from "@frejsi/shared/dosing-vocabulary";
import { describe, expect, it } from "vitest";

import { getMessages } from "@/lib/i18n/messages";
import { LOCALES } from "@/lib/i18n/routing";

const ADVICE = ["bør", "skal", "should", "take", "give", "giv", "næste gang", "next time"];

const strings = (value: unknown, where: string): [string, string][] =>
  typeof value === "string"
    ? [[where, value]]
    : typeof value === "object" && value !== null
      ? Object.entries(value).flatMap(([k, v]) => strings(v, `${where}.${k}`))
      : [];

const advice = (text: string) =>
  ADVICE.filter((word) =>
    new RegExp(`(?<![\\p{L}\\p{N}_])${word}(?![\\p{L}\\p{N}_])`, "iu").test(text),
  );

describe("copy test (plan §9): mealDetail.*", () => {
  it.each(LOCALES)("%s: no advice word and no 'bolus' in any string", (locale) => {
    const messages = getMessages(locale) as Record<string, unknown>;
    const all = strings(messages.mealDetail, "mealDetail");
    expect(all.length).toBeGreaterThan(15);
    expect(all.filter(([, text]) => advice(text).length > 0)).toEqual([]);
    expect(all.filter(([, text]) => /bolus|insulin/i.test(text))).toEqual([]);
  });
});

// v0.7.0 plan §9: the pump record's copy on meal detail lives in `pumpMeal.*`, a pump-history file.
// Units appear in one string only, beside the bolus time, from a number the pump recorded.
describe("copy test (v0.7.0 plan §9): pumpMeal.*", () => {
  const pumpMeal = (locale: (typeof LOCALES)[number]) =>
    strings((getMessages(locale) as Record<string, unknown>).pumpMeal, `${locale}/pumpMeal.json`);
  it("has the same keys in da and en", () => {
    const keys = (locale: (typeof LOCALES)[number]) =>
      pumpMeal(locale).map(([where]) => where.split(".json")[1]);
    expect(keys("da")).toEqual(keys("en"));
    expect(keys("da").length).toBeGreaterThan(3);
  });
  it.each(LOCALES)(
    "%s: passes the pump scope and the suggestion list, and advises nothing",
    (locale) => {
      const all = pumpMeal(locale).map(
        ([where, text]) => [where.replace(".json.", ".json:"), text] as const,
      );
      expect(findPumpCopyVocabulary(all)).toEqual([]);
      expect(findSuggestionVocabulary(all)).toEqual([]);
      expect(all.filter(([, text]) => advice(text).length > 0)).toEqual([]);
      // The one string with units is the bolus line, and it carries the time with them.
      const withUnits = all.filter(([, text]) => text.includes("{units}"));
      expect(withUnits.map(([where]) => where)).toEqual([`${locale}/pumpMeal.json:bolus`]);
      expect(withUnits[0]?.[1]).toContain("{time}");
    },
  );
});

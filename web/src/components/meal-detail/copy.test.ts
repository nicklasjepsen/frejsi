// The copy test of plan §9 on `mealDetail.*`: the screen describes what happened and never tells
// anyone what to do, and no string of its own contains "bolus" (the bolus tile, legend and marker
// reuse the allowed `stats.*`, `chart.*` and BolusTap keys). Word-bounded, case-insensitive.
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

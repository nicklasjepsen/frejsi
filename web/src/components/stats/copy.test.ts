// The copy test of plan §9 on the namespaces this lane adds: statistics and chart strings
// describe what happened and never tell anyone what to do. Word-bounded, case-insensitive.
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

describe("copy test (plan §9): stats.* and chart.* carry no advice", () => {
  it("flags an advice word, word-bounded", () => {
    expect(advice("Giv bolus")).toEqual(["giv"]);
    expect(advice("you should eat")).toEqual(["should"]);
    expect(advice("næste gang")).toEqual(["næste gang"]);
    expect(advice("Bolus givet")).toEqual([]);
    expect(advice("Bolus given")).toEqual([]);
  });

  it.each(LOCALES)("%s: no string under stats.* or chart.* contains one", (locale) => {
    const messages = getMessages(locale) as Record<string, unknown>;
    const all = [...strings(messages.stats, "stats"), ...strings(messages.chart, "chart")];
    expect(all.length).toBeGreaterThan(20);
    expect(all.filter(([, text]) => advice(text).length > 0)).toEqual([]);
  });
});

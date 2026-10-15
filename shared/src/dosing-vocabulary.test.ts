import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  BOLUS_TAP_ALLOW_LIST,
  DOSING_ALLOW_LIST,
  MEAL_CURVE_ALLOW_LIST,
  findDosingVocabulary,
  messageStrings,
} from "./dosing-vocabulary";

const messagesDir = path.resolve(import.meta.dirname, "../../web/messages");

// The allow-list as #38 left it: the v0.1.0 list plus the two v0.2.0 BolusTap sentences.
const BEFORE_V030 = DOSING_ALLOW_LIST.length + BOLUS_TAP_ALLOW_LIST.length;

describe("dosing allow-list, v0.3.0 (plan §9, task 3)", () => {
  it("grows by exactly the seven enumerated strings and nothing else", () => {
    expect(BEFORE_V030).toBe(12);
    expect([...MEAL_CURVE_ALLOW_LIST]).toEqual([
      "Bolus",
      "Bolus før",
      "Bolus givet",
      "Bolus",
      "Bolus before",
      "Bolus given",
      "Bolus before meal",
    ]);
    expect(BEFORE_V030 + MEAL_CURVE_ALLOW_LIST.length).toBe(19);
  });

  it("passes the seven strings and matches them exactly and case-sensitively", () => {
    const allowed = MEAL_CURVE_ALLOW_LIST.map((s): [string, string] => ["k", s]);
    expect(findDosingVocabulary(allowed)).toEqual([]);
    for (const text of [
      "bolus",
      "Bolus før måltidet",
      "Bolus 12 min",
      "Bolus givet kl. 12",
      "bolus before",
      "Bolus Before Meal",
    ]) {
      expect(findDosingVocabulary([["k", text]]), text).toHaveLength(1);
    }
  });

  it("finds 'bolus' in chart.* and stats.* only in an allowed string, each its own key", () => {
    for (const locale of ["da", "en"]) {
      const files: Record<string, unknown> = {};
      for (const ns of ["chart", "stats"]) {
        files[`${locale}/${ns}.json`] = JSON.parse(
          readFileSync(path.join(messagesDir, locale, `${ns}.json`), "utf8"),
        ) as unknown;
      }
      const strings = messageStrings(files);
      expect(strings.length).toBeGreaterThan(0);
      expect(findDosingVocabulary(strings)).toEqual([]);
      const withBolus = strings.filter(([, text]) => /bolus/i.test(text));
      expect(withBolus.length).toBeGreaterThan(0);
      // "Bolus før måltid" is the v0.1.0 entry; every other one is among the seven.
      const allowed: readonly string[] = [...MEAL_CURVE_ALLOW_LIST, "Bolus før måltid"];
      for (const [where, text] of withBolus) expect(allowed, where).toContain(text);
    }
  });
});

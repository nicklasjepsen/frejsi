import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { z } from "zod";

import {
  BOLUS_TIME,
  DOSING_ALLOW_LIST,
  DOSING_WORDS,
  MEAL_CURVE_ALLOW_LIST,
  PUMP_HISTORY_FILES,
  SUGGESTION_WORDS,
  UNIT_AMOUNT,
  findDosingVocabulary,
  findPumpCopyVocabulary,
  findPumpFieldsInAiInput,
  findSuggestionVocabulary,
  findUnitAmounts,
  isPumpHistoryFile,
  messageStrings,
  schemaVocabulary,
} from "./dosing-vocabulary";
import * as schemas from "./schemas/index";

const messagesDir = path.resolve(import.meta.dirname, "../../web/messages");
const pushMessagesDir = path.resolve(import.meta.dirname, "push/messages");
const pumpMessagesDir = path.resolve(import.meta.dirname, "pump/messages");

/** Every `web/messages/<locale>/<ns>.json`, keyed `<locale>/<ns>.json`. */
function readUiMessages(): Record<string, unknown> {
  const files: Record<string, unknown> = {};
  for (const locale of readdirSync(messagesDir, { withFileTypes: true })) {
    if (!locale.isDirectory()) continue;
    const dir = path.join(messagesDir, locale.name);
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      files[`${locale.name}/${file}`] = JSON.parse(
        readFileSync(path.join(dir, file), "utf8"),
      ) as unknown;
    }
  }
  return files;
}

describe("dosing vocabulary (the hard rule: Frejsi never computes or suggests insulin)", () => {
  it("has exactly the list and the allow-list from the plan (§8)", () => {
    expect([...DOSING_WORDS]).toEqual([
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
    ]);
    expect([...DOSING_ALLOW_LIST]).toEqual([
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
    ]);
    // v0.7.0 (plan §7): the lists and the pattern stay exactly as they were before pump history.
    expect([...MEAL_CURVE_ALLOW_LIST]).toEqual([
      "Bolus",
      "Bolus før",
      "Bolus givet",
      "Bolus",
      "Bolus before",
      "Bolus given",
      "Bolus before meal",
    ]);
    expect(BOLUS_TIME.source).toBe(String.raw`^Bolus (?:\d{2}:\d{2}|\{time\})$`);
    expect(BOLUS_TIME.flags).toBe("");
  });

  it("has exactly the pump-history files and the suggestion list from v0.7.0 plan §7", () => {
    expect([...PUMP_HISTORY_FILES]).toEqual(["pump.json", "pumpMeal.json", "pumpSettings.json"]);
    expect([...SUGGESTION_WORDS]).toEqual([
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
    ]);
    for (const where of [
      "da/pump.json:curve.at",
      "en/pumpMeal.json:badge",
      "da/pumpSettings.json:title",
      "pump/messages/da.json:meal.item",
      "pump/messages/en.json:meal.item",
    ])
      expect(isPumpHistoryFile(where), where).toBe(true);
    for (const where of [
      "da/log.json:bolus.at",
      "en/chart.json:x",
      "push/da.json:estimate.title",
      "da/pumpkin.json:x",
    ])
      expect(isPumpHistoryFile(where), where).toBe(false);
  });

  it("flags a listed word, word-bounded and case-insensitive", () => {
    expect(findDosingVocabulary([["da.json:x", "ordene enheder insulin"]])).toEqual([
      { where: "da.json:x", text: "ordene enheder insulin", term: "insulin" },
      { where: "da.json:x", text: "ordene enheder insulin", term: "enheder insulin" },
    ]);
    expect(findDosingVocabulary([["k", "Insulin"]])).toHaveLength(1);
    expect(findDosingVocabulary([["k", "Din ICR er 10"]]).map((f) => f.term)).toEqual(["ICR"]);
    expect(findDosingVocabulary([["k", "Korrektion"]]).map((f) => f.term)).toEqual(["korrektion"]);
    expect(findDosingVocabulary([["k", "the ratio"]]).map((f) => f.term)).toEqual(["ratio"]);
    expect(findDosingVocabulary([["k", "dose it"]]).map((f) => f.term)).toEqual(["dose"]);
  });

  it("does not flag the bare words units and enheder, or words that only contain a listed one", () => {
    expect(
      findDosingVocabulary([
        ["k", "Enheder"],
        ["k", "Glucose unit"],
      ]),
    ).toEqual([]);
    // "2 units" is not a dosing word; since v0.7.0 it is a unit amount, which fails on its own.
    expect(findDosingVocabulary([["k", "2 units"]])).toEqual([]);
    expect(findUnitAmounts([["k", "2 units"]])).toEqual([
      { where: "k", text: "2 units", amount: "2 units" },
    ]);
    expect(
      findDosingVocabulary([
        ["k", "insulinpumpe"],
        ["k", "rationel"],
        ["k", "pied"],
      ]),
    ).toEqual([]);
  });

  it("passes the enumerated allow-list and the Bolus HH:MM pattern, and nothing else", () => {
    const allowed = [...DOSING_ALLOW_LIST, "Bolus 12:30", "Bolus 07:05"].map(
      (s): [string, string] => ["k", s],
    );
    expect(findDosingVocabulary(allowed)).toEqual([]);
    expect(
      findDosingVocabulary([["k", "Bolus 12:30 og ordene enheder insulin"]]).map((f) => f.term),
    ).toEqual(["insulin", "bolus", "enheder insulin"]);
    expect(findDosingVocabulary([["k", "Bolus nu"]])).toHaveLength(1);
    expect(
      findDosingVocabulary([["k", "regner aldrig insulin eller dosis"]]).map((f) => f.term),
    ).toEqual(["insulin", "dosis"]);
  });

  it("walks every exported Zod schema's keys and enum values", () => {
    const vocabulary = schemaVocabulary(schemas);
    // Each schema is walked once, under the first export that reaches it.
    expect(vocabulary.some(([where, text]) => text === "mmol" && where.endsWith(".mmol"))).toBe(
      true,
    );
    expect(vocabulary.map(([, text]) => text)).toContain("tokenHash");
    expect(vocabulary.map(([, text]) => text)).toContain("double-up");
    expect(findDosingVocabulary(vocabulary)).toEqual([]);
  });

  it("reads every string in web/messages/<locale>/*.json", () => {
    const strings = messageStrings({ "da/a.json": { b: "Hej", c: ["x", "y"] } });
    expect(strings).toEqual([
      ["da/a.json:b", "Hej"],
      ["da/a.json:c.0", "x"],
      ["da/a.json:c.1", "y"],
    ]);
  });

  it("finds no dosing vocabulary in the push copy, both locales, estimate and symptom alike", () => {
    const files: Record<string, unknown> = {};
    for (const file of readdirSync(pushMessagesDir).filter((f) => f.endsWith(".json"))) {
      files[`push/${file}`] = JSON.parse(
        readFileSync(path.join(pushMessagesDir, file), "utf8"),
      ) as unknown;
    }
    expect(Object.keys(files).sort()).toEqual(["push/da.json", "push/en.json"]);
    const strings = messageStrings(files);
    expect(strings.map(([where]) => where)).toEqual(
      expect.arrayContaining(["push/da.json:estimate.title", "push/da.json:symptom.body"]),
    );
    expect(findDosingVocabulary(strings)).toEqual([]);
    expect(findUnitAmounts(strings)).toEqual([]);
  });

  it("finds no dosing vocabulary or unit amount in the UI strings outside pump history", () => {
    const files = readUiMessages();
    // Both locales are read, namespace by namespace; an empty walk would pass vacuously.
    expect(Object.keys(files)).toEqual(expect.arrayContaining(["da/app.json", "en/app.json"]));
    const strings = messageStrings(files).filter(([where]) => !isPumpHistoryFile(where));
    expect(strings.length).toBeGreaterThan(100);
    expect(findDosingVocabulary(strings)).toEqual([]);
    expect(findUnitAmounts(strings)).toEqual([]);
  });

  it("reads the pump-history files with the pump scope, and shared/src/pump/messages with key parity", () => {
    const ui = messageStrings(readUiMessages()).filter(([where]) => isPumpHistoryFile(where));
    expect(findPumpCopyVocabulary(ui)).toEqual([]);
    const files: Record<string, unknown> = {};
    for (const file of readdirSync(pumpMessagesDir).filter((f) => f.endsWith(".json"))) {
      files[`pump/messages/${file}`] = JSON.parse(
        readFileSync(path.join(pumpMessagesDir, file), "utf8"),
      ) as unknown;
    }
    expect(Object.keys(files).sort()).toEqual(["pump/messages/da.json", "pump/messages/en.json"]);
    const strings = messageStrings(files);
    expect(strings.map(([where]) => where)).toContain("pump/messages/da.json:meal.item");
    expect(findPumpCopyVocabulary(strings)).toEqual([]);
    const keys = (file: string) =>
      strings
        .filter(([where]) => where.startsWith(`${file}:`))
        .map(([where]) => where.split(":")[1]);
    expect(keys("pump/messages/da.json")).toEqual(keys("pump/messages/en.json"));
    expect(keys("pump/messages/da.json").length).toBeGreaterThan(0);
  });

  it("lets pump.json show what the pump delivered and nothing that advises (v0.7.0 plan §7)", () => {
    const pump = (text: string): [string, string] => ["da/pump.json:k", text];
    expect(findPumpCopyVocabulary([pump("Automatisk bolus 03:10 · 0,6 E")])).toEqual([]);
    expect(findPumpCopyVocabulary([pump("Bolus 11:58 · 2,4 E")])).toEqual([]);
    expect(findPumpCopyVocabulary([pump("Pumpe til 11:58")])).toEqual([]);
    expect(findPumpCopyVocabulary([pump("Du bør give 2 E")]).map((f) => f.term)).toEqual([
      "bør",
      "give",
    ]);
    expect(findPumpCopyVocabulary([pump("Korrektion 1 E")]).map((f) => f.term)).toEqual([
      "korrektion",
    ]);
    expect(findPumpCopyVocabulary([pump("Beregnet bolus")]).map((f) => f.term)).toEqual([
      "beregn*",
    ]);
    expect(findPumpCopyVocabulary([pump("ratio")]).map((f) => f.term)).toEqual(["ratio"]);
    for (const text of [
      "2 enheder insulin",
      "Dosis 2 E",
      "ICR 10",
      "Tag 2 E næste gang",
      "We suggest 2 U",
    ])
      expect(findPumpCopyVocabulary([pump(text)]), text).not.toEqual([]);
  });

  it("fails on a unit amount and on bolus in any other namespace", () => {
    const other = (text: string): [string, string] => ["da/chart.json:k", text];
    expect(findDosingVocabulary([other("Bolus 2,4 E")]).map((f) => f.term)).toEqual(["bolus"]);
    expect(findUnitAmounts([other("Bolus 2,4 E")]).map((f) => f.amount)).toEqual(["2,4 E"]);
    expect(findUnitAmounts([other("giv 2 enheder")]).map((f) => f.amount)).toEqual(["2 enheder"]);
    expect(findUnitAmounts([other("{count} enheder")]).map((f) => f.amount)).toEqual([
      "{count} enheder",
    ]);
    expect(findUnitAmounts([other("1.5 U"), other("3 IE"), other("# units")])).toHaveLength(3);
    // A number next to something else, or a device count, is not an amount of insulin.
    expect(
      findUnitAmounts([
        other("ca. {carbs} g"),
        other("6,2 mmol/L"),
        other("{count, plural, one {# enhed} other {# enheder}}"),
        other("{count, plural, one {# device} other {# devices}}"),
        other("Enheder"),
        other("Vitamin E"),
        other("2 eksempler"),
      ]),
    ).toEqual([]);
  });

  it("fails on a suggestion word in any schema key or enum value, and finds none today", () => {
    expect(findSuggestionVocabulary(schemaVocabulary(schemas))).toEqual([]);
    const bad = {
      Bad: z.strictObject({ suggestedUnits: z.number(), kind: z.enum(["take", "ok"]) }),
    };
    expect(findSuggestionVocabulary(schemaVocabulary(bad)).map((f) => [f.text, f.term])).toEqual([
      ["suggestedUnits", "suggest*"],
      ["take", "take"],
    ]);
    expect(
      findSuggestionVocabulary([
        ["k", "anbefalet"],
        ["k", "Beregn"],
        ["k", "tag"],
        ["k", "tags"],
      ]).map((f) => f.text),
    ).toEqual(["anbefalet", "Beregn", "tag"]);
  });

  it("keeps the pump record out of every AI input (spec §5)", () => {
    const { InsightInput, WeekInsightInput } = schemas;
    expect(findPumpFieldsInAiInput(schemaVocabulary({ InsightInput, WeekInsightInput }))).toEqual(
      [],
    );
    for (const extra of [
      { bolusUnits: z.number() },
      { units: z.number() },
      { pumpCarbs: z.number() },
      { pumpBolusId: z.string() },
      { pump: z.strictObject({ carbs: z.number() }) },
    ]) {
      const [key] = Object.keys(extra);
      expect(
        findPumpFieldsInAiInput(schemaVocabulary({ InsightInput: InsightInput.extend(extra) })),
        key,
      ).not.toEqual([]);
      expect(
        findPumpFieldsInAiInput(
          schemaVocabulary({ WeekInsightInput: WeekInsightInput.extend(extra) }),
        ),
        key,
      ).not.toEqual([]);
    }
  });

  it("rejects bolus and a unit amount in a model answer, with no allow-list and no pump scope", async () => {
    const { assertNoDosing } = await import("./ai/guard");
    for (const text of ["Bolus 11:58", "bolus", "2 units", "Automatisk bolus 03:10 · 0,6 E", "2 E"])
      expect(() => {
        assertNoDosing(text, "da/pump.json:k");
      }, text).toThrow();
    expect(() => {
      assertNoDosing("Toppen kom efter en time.", "k");
    }).not.toThrow();
  });
});

it("dosing guard covers every AI prompt and accepted insight fixture without the UI allow-list", async () => {
  const { assertNoDosing } = await import("./ai/guard");
  const { MealInsight, WeekInsight } = await import("./schemas/ai");
  const aiDir = path.join(import.meta.dirname, "ai");
  const prompts = readdirSync(aiDir, { recursive: true })
    .map(String)
    .filter((file) => /^prompt.*\.ts$/.test(path.basename(file)) && !file.endsWith(".test.ts"))
    .sort();
  const walked: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (/^prompt.*\.ts$/.test(entry.name) && !entry.name.endsWith(".test.ts")) {
        walked.push(path.relative(aiDir, file));
        const text = readFileSync(file, "utf8");
        assertNoDosing(text, file);
        expect(UNIT_AMOUNT.test(text), file).toBe(false);
      }
    }
  };
  walk(aiDir);
  expect(walked.sort()).toEqual(prompts);
  const fixtures = path.resolve(import.meta.dirname, "../../fixtures/ai/insight");
  const files = readdirSync(fixtures).filter((file) => file.endsWith(".json"));
  expect(files).toEqual(expect.arrayContaining(["meal-da.json", "week-en.json"]));
  for (const file of files) {
    const value = JSON.parse(readFileSync(path.join(fixtures, file), "utf8")) as unknown;
    expect(MealInsight.safeParse(value).success || WeekInsight.safeParse(value).success).toBe(true);
    for (const [where, text] of messageStrings({ [file]: value })) {
      assertNoDosing(text, where);
      expect(UNIT_AMOUNT.test(text), where).toBe(false);
    }
  }
});

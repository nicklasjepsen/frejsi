import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  DOSING_ALLOW_LIST,
  DOSING_WORDS,
  findDosingVocabulary,
  messageStrings,
  schemaVocabulary,
} from "./dosing-vocabulary";
import * as schemas from "./schemas/index";

const messagesDir = path.resolve(import.meta.dirname, "../../web/messages");

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
        ["k", "2 units"],
        ["k", "Glucose unit"],
      ]),
    ).toEqual([]);
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

  it("finds no dosing vocabulary in the UI strings that exist today", () => {
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
    // Both locales are read, namespace by namespace; an empty walk would pass vacuously.
    expect(Object.keys(files)).toEqual(expect.arrayContaining(["da/app.json", "en/app.json"]));
    expect(findDosingVocabulary(messageStrings(files))).toEqual([]);
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
        assertNoDosing(readFileSync(file, "utf8"), file);
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
    for (const [where, text] of messageStrings({ [file]: value })) assertNoDosing(text, where);
  }
});

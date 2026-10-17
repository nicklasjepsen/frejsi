import { findDosingVocabulary, messageStrings } from "@frejsi/shared/dosing-vocabulary";
import { describe, expect, it } from "vitest";

import da from "../../../messages/da/log.json";
import en from "../../../messages/en/log.json";

// Issue #215: the "Bolus givet nu" tap is gone; the bolus time comes from an imported pump record,
// later. The only bolus string left in the log copy is the time template the chart legend and the
// meal markers use for a stored time.
describe("the log copy's only bolus string: a stored time", () => {
  it.each([
    ["da", da],
    ["en", en],
  ] as const)("%s: keeps only Bolus {time}, with no tap, removal, undo or note", (_locale, copy) => {
    expect(copy.bolus).toEqual({ at: "Bolus {time}" });
  });

  it("accepts the Bolus HH:MM template and still flags anything that is not a time", () => {
    expect(findDosingVocabulary([["k", "Bolus {time}"]])).toEqual([]);
    expect(findDosingVocabulary([["k", "Bolus {amount}"]])).toHaveLength(1);
    expect(findDosingVocabulary([["k", "Bolus {time} enheder"]])).toHaveLength(1);
  });

  it("finds no dosing vocabulary in the log screen's strings", () => {
    expect(findDosingVocabulary(messageStrings({ "da/log.json": da, "en/log.json": en }))).toEqual(
      [],
    );
  });

  it("has no amount, unit or ratio next to the bolus anywhere in the log copy", () => {
    const strings = messageStrings({ da, en }).map(([, text]) => text);
    for (const text of strings.filter((s) => /bolus/i.test(s))) {
      expect(text).not.toMatch(/\d+\s*(?:E|IE|U|IU|enheder|units)\b/i);
    }
  });
});

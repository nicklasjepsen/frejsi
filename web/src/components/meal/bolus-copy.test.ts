import {
  BOLUS_TAP_ALLOW_LIST,
  DOSING_ALLOW_LIST,
  findDosingVocabulary,
  messageStrings,
} from "@frejsi/shared/dosing-vocabulary";
import { describe, expect, it } from "vitest";

import da from "../../../messages/da/log.json";
import en from "../../../messages/en/log.json";

// Plan §8: task 7 adds exactly these two sentences, as drawn on Log-Portioner, and nothing else.
const DRAWN_DA =
  '"Bolus givet nu" gemmer kun tidspunktet, så det kan ses på kurven. Frejsi regner aldrig insulin.';
const DRAWN_EN =
  '"Bolus given now" saves only the time so it can be seen on the curve. Frejsi never calculates insulin.';

describe("the bolus tap copy (the single allowed insulin concept: a timestamp)", () => {
  it("adds exactly the two quoted sentences to the allow-list", () => {
    expect([...BOLUS_TAP_ALLOW_LIST]).toEqual([DRAWN_DA, DRAWN_EN]);
    expect(DOSING_ALLOW_LIST).not.toContain(DRAWN_DA);
  });

  it("uses the drawn sentence and the already allowed button labels", () => {
    expect(da.bolus.note).toBe(DRAWN_DA);
    expect(en.bolus.note).toBe(DRAWN_EN);
    expect(DOSING_ALLOW_LIST).toContain(da.bolus.button);
    expect(DOSING_ALLOW_LIST).toContain(en.bolus.button);
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

  it("allows exactly the two timestamp removal labels", () => {
    expect(da.bolus.remove).toBe("Fjern bolustidspunkt");
    expect(en.bolus.remove).toBe("Remove bolus time");
    expect(findDosingVocabulary([["k", en.bolus.remove]])).toEqual([]);
    expect(findDosingVocabulary([["k", "Remove bolus time now"]])).toHaveLength(1);
  });

  it("has no amount, unit or ratio next to the bolus anywhere in the log copy", () => {
    const strings = messageStrings({ da, en }).map(([, text]) => text);
    for (const text of strings.filter((s) => /bolus/i.test(s))) {
      expect(text).not.toMatch(/\d+\s*(?:E|IE|U|IU|enheder|units)\b/i);
    }
  });
});

// The curve's pump copy (v0.7.0 plan §7, §9): `pump.json` in both locales with the same keys, units
// only through the `{units}` placeholder that `formatUnits` fills, and nothing that advises.
import { findPumpCopyVocabulary, findSuggestionVocabulary } from "@frejsi/shared/dosing-vocabulary";
import { describe, expect, it } from "vitest";

import da from "../../../messages/da/pump.json";
import en from "../../../messages/en/pump.json";

interface Tree {
  [key: string]: string | Tree;
}
const flat = (tree: Tree, prefix = ""): [string, string][] =>
  Object.entries(tree).flatMap(([key, value]) =>
    typeof value === "string" ? [[`${prefix}${key}`, value]] : flat(value, `${prefix}${key}.`),
  );

describe("pump.json (v0.7.0 plan §7)", () => {
  it("has the same keys in da and en", () => {
    expect(flat(en).map(([key]) => key)).toEqual(flat(da).map(([key]) => key));
  });

  it("shows units only through the {units} placeholder, beside a {time}", () => {
    for (const [locale, tree] of [
      ["da", da],
      ["en", en],
    ] as const) {
      for (const [key, text] of flat(tree)) {
        expect(text, `${locale}:${key}`).not.toMatch(/\d/);
        if (text.includes("{units}")) expect(text, `${locale}:${key}`).toContain("{time}");
      }
      expect(tree.marker.bolus).toContain("{units}");
      expect(tree.marker.automatic).toContain("{units}");
    }
  });

  it("passes the pump scope and the suggestion list", () => {
    const strings = [
      ...flat(da).map(([key, text]): [string, string] => [`da/pump.json:${key}`, text]),
      ...flat(en).map(([key, text]): [string, string] => [`en/pump.json:${key}`, text]),
    ];
    expect(findPumpCopyVocabulary(strings)).toEqual([]);
    expect(findSuggestionVocabulary(strings)).toEqual([]);
  });

  it("reads like the rendered examples of the plan", () => {
    expect(da.marker.bolus).toBe("Bolus {time} · {units}");
    expect(da.marker.automatic).toBe("Automatisk bolus {time} · {units}");
    expect(da.legend).toEqual({ bolus: "Bolus (pumpe)", automatic: "Automatisk bolus" });
    expect(da.reach).toBe("Pumpe til {time}");
  });
});

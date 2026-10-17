import { describe, expect, it } from "vitest";
import { DEFAULT_SYMPTOM_KINDS } from "../schemas/symptom";
import { findDosingVocabulary } from "../dosing-vocabulary";
import { DEFAULT_KIND_LABELS, isKnownKind, parseSpaceKinds, symptomKindLabel } from "./kinds";

const custom = [{ id: "custom:itchy", label: { da: "Kloe", en: "Itchy" } }];

describe("symptom kinds", () => {
  it("labels every default kind in both languages, free of dosing words", () => {
    for (const kind of DEFAULT_SYMPTOM_KINDS) {
      expect(symptomKindLabel(kind, "da")).toBe(DEFAULT_KIND_LABELS[kind].da);
      expect(symptomKindLabel(kind, "en")).toBe(DEFAULT_KIND_LABELS[kind].en);
      expect(symptomKindLabel(kind, "da")).not.toBe(symptomKindLabel(kind, "en"));
    }
    expect(symptomKindLabel("stomach-ache", "da")).toBe("Ondt i maven");
    expect(symptomKindLabel("dizzy", "en")).toBe("Dizzy");
    const strings = Object.entries(DEFAULT_KIND_LABELS).flatMap(([kind, label]) =>
      (["da", "en"] as const).map((locale): [string, string] => [`${kind}.${locale}`, label[locale]]),
    );
    expect(findDosingVocabulary(strings)).toEqual([]);
  });

  it("labels a space's custom kind from its own list and falls back to the slug", () => {
    expect(symptomKindLabel("custom:itchy", "da", custom)).toBe("Kloe");
    expect(symptomKindLabel("custom:itchy", "en", custom)).toBe("Itchy");
    expect(symptomKindLabel("custom:itchy", "en")).toBe("itchy");
  });

  it("knows the defaults and the space's kinds, nothing else", () => {
    expect(isKnownKind("tired", [])).toBe(true);
    expect(isKnownKind("custom:itchy", custom)).toBe(true);
    expect(isKnownKind("custom:itchy", [])).toBe(false);
    expect(isKnownKind("custom:other", custom)).toBe(false);
  });

  it("parses the stored JSON list leniently: bad JSON or a bad entry is an empty list", () => {
    expect(parseSpaceKinds(JSON.stringify(custom))).toEqual(custom);
    expect(parseSpaceKinds("[]")).toEqual([]);
    expect(parseSpaceKinds("not json")).toEqual([]);
    expect(parseSpaceKinds(JSON.stringify([{ id: "nope" }]))).toEqual([]);
    expect(parseSpaceKinds(null)).toEqual([]);
  });
});

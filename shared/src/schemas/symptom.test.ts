import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { findDosingVocabulary, schemaVocabulary } from "../dosing-vocabulary";
import * as exported from "./index";
import * as symptom from "./symptom";

const NOW = new Date("2026-10-15T12:00:00.000Z");
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000).toISOString();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("SymptomKind", () => {
  it("accepts the six defaults and custom:<slug>, and rejects anything else", () => {
    expect([...symptom.DEFAULT_SYMPTOM_KINDS]).toEqual([
      "stomach-ache",
      "dizzy",
      "nausea",
      "tired",
      "headache",
      "shaky",
    ]);
    for (const kind of symptom.DEFAULT_SYMPTOM_KINDS)
      expect(symptom.SymptomKind.parse(kind)).toBe(kind);
    expect(symptom.SymptomKind.parse("custom:itchy-feet")).toBe("custom:itchy-feet");
    for (const bad of ["", "sad", "custom:", "custom:Itchy", "custom:-x", "Tired", "custom:a b"])
      expect(symptom.SymptomKind.safeParse(bad).success, bad).toBe(false);
    // The column is NVarChar(40).
    expect(symptom.SymptomKind.safeParse(`custom:${"a".repeat(33)}`).success).toBe(true);
    expect(symptom.SymptomKind.safeParse(`custom:${"a".repeat(34)}`).success).toBe(false);
  });
  it("names three severities and a custom kind with both labels", () => {
    expect(symptom.Severity.options).toEqual(["light", "medium", "strong"]);
    const kind = { id: "custom:itchy-feet", label: { da: "Kløe i fødderne", en: "Itchy feet" } };
    expect(symptom.SpaceSymptomKind.parse(kind)).toEqual(kind);
    expect(symptom.SpaceSymptomKind.safeParse({ ...kind, id: "tired" }).success).toBe(false);
    expect(symptom.SpaceSymptomKind.safeParse({ ...kind, label: { da: "Kløe" } }).success).toBe(
      false,
    );
  });
});

describe("CreateSymptomRequest", () => {
  it("defaults ts to now and keeps an explicit time inside the window", () => {
    expect(symptom.CreateSymptomRequest.parse({ kind: "tired" })).toEqual({
      kind: "tired",
      ts: NOW.toISOString(),
    });
    const full = { kind: "headache", ts: minutes(-30), severity: "medium", note: "After lunch" };
    expect(symptom.CreateSymptomRequest.parse(full)).toEqual(full);
    expect(symptom.CreateSymptomRequest.safeParse({ kind: "tired", ts: minutes(10) }).success).toBe(
      true,
    );
    expect(
      symptom.CreateSymptomRequest.safeParse({ kind: "tired", ts: minutes(-7 * 24 * 60) }).success,
    ).toBe(true);
  });
  it("rejects a time more than 10 minutes ahead or older than 7 days, and a long note", () => {
    expect(symptom.CreateSymptomRequest.safeParse({ kind: "tired", ts: minutes(11) }).success).toBe(
      false,
    );
    expect(
      symptom.CreateSymptomRequest.safeParse({ kind: "tired", ts: minutes(-7 * 24 * 60 - 1) })
        .success,
    ).toBe(false);
    expect(
      symptom.CreateSymptomRequest.safeParse({ kind: "tired", note: "x".repeat(501) }).success,
    ).toBe(false);
    expect(symptom.CreateSymptomRequest.safeParse({ kind: "tired", severity: "bad" }).success).toBe(
      false,
    );
    expect(symptom.CreateSymptomRequest.safeParse({ kind: "tired", mmol: 6 }).success).toBe(false);
  });
});

describe("UpdateSymptomRequest, SymptomView and the range query", () => {
  it("is a partial patch whose resolvedTs may be cleared with null", () => {
    expect(symptom.UpdateSymptomRequest.parse({})).toEqual({});
    expect(symptom.UpdateSymptomRequest.parse({ resolvedTs: null })).toEqual({ resolvedTs: null });
    expect(symptom.UpdateSymptomRequest.parse({ resolvedTs: minutes(0) })).toEqual({
      resolvedTs: minutes(0),
    });
    expect(symptom.UpdateSymptomRequest.safeParse({ kind: "custom:x" }).success).toBe(true);
    expect(symptom.UpdateSymptomRequest.safeParse({ ts: minutes(11) }).success).toBe(false);
    expect(symptom.UpdateSymptomRequest.safeParse({ kind: null }).success).toBe(false);
  });
  it("views a symptom with who logged it and never a reading", () => {
    const view = {
      id: "sy1",
      kind: "dizzy",
      ts: minutes(-5),
      severity: "light",
      byUserId: "u1",
      byName: "Example carer",
    };
    expect(symptom.SymptomView.parse(view)).toEqual(view);
    expect(symptom.SymptomsView.parse({ symptoms: [view] })).toEqual({ symptoms: [view] });
    expect(symptom.SymptomView.safeParse({ ...view, mmol: 6 }).success).toBe(false);
    expect(symptom.SymptomView.safeParse({ ...view, readings: [] }).success).toBe(false);
  });
  it("bounds a range query to eight days in order", () => {
    const from = minutes(-8 * 24 * 60);
    expect(symptom.SymptomRangeQuery.parse({ from, to: minutes(0) })).toEqual({
      from,
      to: minutes(0),
    });
    expect(
      symptom.SymptomRangeQuery.safeParse({ from: minutes(-8 * 24 * 60 - 1), to: minutes(0) })
        .success,
    ).toBe(false);
    expect(symptom.SymptomRangeQuery.safeParse({ from: minutes(0), to: minutes(-1) }).success).toBe(
      false,
    );
  });
});

it("is exported from the schema index and carries no dosing or glucose word", () => {
  for (const name of [
    "SymptomKind",
    "DEFAULT_SYMPTOM_KINDS",
    "Severity",
    "SpaceSymptomKind",
    "CreateSymptomRequest",
    "UpdateSymptomRequest",
    "SymptomView",
    "SymptomsView",
    "SymptomRangeQuery",
  ])
    expect(exported).toHaveProperty(name, (symptom as Record<string, unknown>)[name]);
  const vocabulary = schemaVocabulary(symptom);
  expect(findDosingVocabulary(vocabulary)).toEqual([]);
  expect(
    vocabulary.filter(([, key]) => /^(mmol|mgdl|trend|reading|readings|glucose)$/i.test(key)),
  ).toEqual([]);
});

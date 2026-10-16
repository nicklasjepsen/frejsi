import { describe, expect, it } from "vitest";
import { schemaVocabulary } from "../dosing-vocabulary";
import { ContributionResult, ContributionsView, FoodCorrection, FoodView } from "./food";
const base = {
  id: "f1",
  name: "Example loaf",
  origin: "manual",
  portions: [],
  verified: false,
  favourite: false,
  createdAt: "2026-10-14T08:00:00Z",
  updatedAt: "2026-10-15T08:00:00Z",
};
it("accepts additive food provenance without exposing glucose", () => {
  const enriched = {
    ...base,
    sourceName: "EXAMPLE LOAF",
    createdBy: { id: "u1", name: "Example Person" },
    createdAt: "2026-10-14T08:00:00Z",
  };
  expect(FoodView.parse(enriched)).toEqual(enriched);
  expect(FoodView.parse(base)).toEqual(base);
  const { createdAt: _createdAt, ...missingTimestamp } = base;
  expect(FoodView.safeParse(missingTimestamp).success).toBe(false);
  expect(FoodView.safeParse({ ...enriched, createdBy: "u1" }).success).toBe(false);
  expect(FoodView.safeParse({ ...enriched, createdAt: "yesterday" }).success).toBe(false);
  expect(
    schemaVocabulary({ FoodView }).filter(([, key]) =>
      /^(mmol|mgdl|trend|reading|readings|glucose)$/i.test(key),
    ),
  ).toEqual([]);
});

const valid = {
  barcode: "2000000000008",
  carbsPer100g: 40,
  servingSize: { grams: 45 },
  appRef: "a1",
};

describe("FoodCorrection", () => {
  it("accepts a correction and normalises the barcode", () => {
    expect(FoodCorrection.parse(valid)).toEqual(valid);
    expect(
      FoodCorrection.parse({ barcode: "2000000000008", appRef: "a1" }).carbsPer100g,
    ).toBeUndefined();
    expect(
      FoodCorrection.parse({ ...valid, servingSize: { grams: 45, label: "1 skive" } }),
    ).toBeTruthy();
  });
  it("rejects a name key, a bad checksum and out-of-range values", () => {
    expect(FoodCorrection.safeParse({ ...valid, name: "Rugbrød" }).success).toBe(false);
    expect(FoodCorrection.safeParse({ ...valid, barcode: "2000000000009" }).success).toBe(false);
    expect(FoodCorrection.safeParse({ ...valid, carbsPer100g: 100.5 }).success).toBe(false);
    expect(FoodCorrection.safeParse({ ...valid, carbsPer100g: 40.25 }).success).toBe(false);
    expect(FoodCorrection.safeParse({ ...valid, servingSize: { grams: 0 } }).success).toBe(false);
    expect(FoodCorrection.safeParse({ ...valid, servingSize: { grams: 5001 } }).success).toBe(
      false,
    );
    expect(FoodCorrection.safeParse({ ...valid, appRef: "" }).success).toBe(false);
    expect(FoodCorrection.safeParse({ ...valid, appRef: "x".repeat(65) }).success).toBe(false);
  });
});

describe("ContributionResult", () => {
  it("accepts the five statuses only", () => {
    for (const status of ["ok", "bad-credentials", "rejected", "rate-limited", "error"])
      expect(ContributionResult.parse({ status })).toEqual({ status });
    expect(ContributionResult.safeParse({ status: "maybe" }).success).toBe(false);
    expect(ContributionResult.safeParse({ status: "ok", message: "x" }).success).toBe(false);
  });
});

describe("ContributionsView", () => {
  it("lists plugin ids and nothing else", () => {
    expect(ContributionsView.parse({ available: ["off"] })).toEqual({ available: ["off"] });
    expect(ContributionsView.safeParse({ available: ["Not An Id"] }).success).toBe(false);
    expect(ContributionsView.safeParse({ available: ["off"], host: "x" }).success).toBe(false);
    expect(Object.keys(ContributionsView.shape)).toEqual(["available"]);
  });
});

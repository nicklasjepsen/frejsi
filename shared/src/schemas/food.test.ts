import { expect, it } from "vitest";
import { schemaVocabulary } from "../dosing-vocabulary";
import { FoodView } from "./food";
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

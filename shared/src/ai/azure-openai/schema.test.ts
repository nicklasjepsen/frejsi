import { expect, it } from "vitest";
import { z } from "zod";
import { ParsedMeal, ParsedMealDraft, PhotoEstimate } from "../../schemas/ai";
import { azureSchema, restoreOptionals } from "./schema";

it("restores nested optional fields in real photo and parse contracts", () => {
  const item = { name: "Apple", grams: null, carbs: 12, confidence: "low", approx: true };
  expect(
    PhotoEstimate.parse(
      restoreOptionals(
        { items: [item], totalCarbs: 12, dishName: "Apple", approx: true },
        PhotoEstimate,
      ),
    ).items[0],
  ).not.toHaveProperty("grams");
  expect(
    ParsedMeal.parse(
      restoreOptionals(
        { items: [{ query: "apple", match: null, estimate: item }], unmatched: [] },
        ParsedMeal,
      ),
    ).items[0]?.estimate,
  ).not.toHaveProperty("grams");
  // Producing the schema must also work for the contracts' refinements and unions.
  expect(azureSchema(ParsedMeal)).toMatchObject({ type: "object", additionalProperties: false });
  expect(azureSchema(ParsedMealDraft)).toMatchObject({
    type: "object",
    additionalProperties: false,
  });
  expect(
    ParsedMealDraft.parse(
      restoreOptionals(
        {
          items: [
            {
              query: "apple",
              match: { source: "off", foodRef: "off:apple", portionLabel: null, grams: 120 },
              estimate: null,
            },
          ],
          unmatched: [],
          symptoms: null,
        },
        ParsedMealDraft,
      ),
    ).items[0],
  ).toEqual({ query: "apple", match: { source: "off", foodRef: "off:apple", grams: 120 } });
});
it("preserves null for optional properties whose contract actually accepts null", () => {
  const schema = z.object({ label: z.string().nullable().optional() });
  expect(restoreOptionals({ label: null }, schema)).toEqual({ label: null });
});

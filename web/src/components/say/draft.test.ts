import { expect, it } from "vitest";
import { CreateMealRequest } from "@frejsi/shared/schemas/meal";
import { emptyDraft, toMealRequest } from "../meal/draft";
import { prepareParsedItems, appendParsedItems } from "./draft";

const candidate = {
  name: "Example bread",
  origin: "off",
  sourceRef: "off:bread",
  carbsPer100g: 40,
  portions: [{ label: "2 slices", carbs: 36 }],
};
it("copies candidates before saving, keeps library identity and sends guesses as typed carbs only", async () => {
  const { sourceRef: _sourceRef, ...fields } = candidate;
  const food = {
    ...fields,
    id: "f1",
    verified: false,
    favourite: false,
    createdAt: "2026-10-15T10:00:00.000Z",
    updatedAt: "2026-10-15T10:00:00.000Z",
  };
  const picked: unknown[] = [];
  const items = await prepareParsedItems(
    [
      { query: "bread", match: { source: "cache", food: candidate, portionLabel: "2 slices" } },
      { query: "bread", match: { source: "library", food, grams: 100 } },
      { query: "apple", estimate: { name: "Apple", carbs: 14, confidence: "low", approx: true } },
    ],
    (value) => {
      picked.push(value);
      return Promise.resolve(food);
    },
  );
  expect(picked).toEqual([candidate]);
  const request = toMealRequest(appendParsedItems(emptyDraft(), items), null);
  expect(CreateMealRequest.parse(request)).toEqual(request);
  expect(request).toEqual({
    items: [
      { foodId: "f1", name: "Example bread", portionLabel: "2 slices", carbs: 36 },
      { foodId: "f1", name: "Example bread", grams: 100, carbs: 40 },
      { name: "Apple", carbs: 14 },
    ],
  });
});

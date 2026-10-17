import { describe, expect, it } from "vitest";

import * as publicExports from "../index";
import { mealSymbol, storedSymbol } from "./symbol";

describe("mealSymbol (v0.6.0 plan §4)", () => {
  it("is unknown for no items", () => {
    expect(mealSymbol([])).toBe("unknown");
  });
  it("is the category of a single item", () => {
    expect(mealSymbol([{ carbs: 24, category: "bread" }])).toBe("bread");
  });
  it("is the dominant category when it carries more than half the carbs", () => {
    expect(
      mealSymbol([
        { carbs: 30, category: "bread" },
        { carbs: 10, category: "dairy" },
      ]),
    ).toBe("bread");
    expect(
      mealSymbol([
        { carbs: 10, category: "dairy" },
        { carbs: 30, category: "bread" },
        { carbs: 5, category: "fruit" },
      ]),
    ).toBe("bread");
  });
  it("is mixed when nothing dominates", () => {
    expect(
      mealSymbol([
        { carbs: 20, category: "bread" },
        { carbs: 20, category: "starch" },
      ]),
    ).toBe("mixed");
    expect(
      mealSymbol([
        { carbs: 15, category: "bread" },
        { carbs: 15, category: "starch" },
        { carbs: 10, category: "fruit" },
      ]),
    ).toBe("mixed");
  });
  it("is unknown when the dominant item has no category", () => {
    expect(mealSymbol([{ carbs: 30 }, { carbs: 10, category: "dairy" }])).toBe("unknown");
    expect(mealSymbol([{ carbs: 30, category: null }, { carbs: 10, category: "dairy" }])).toBe(
      "unknown",
    );
    expect(mealSymbol([{ carbs: 0 }])).toBe("unknown");
  });
  it("takes the first item's category when every item has zero carbs", () => {
    expect(
      mealSymbol([
        { carbs: 0, category: "protein" },
        { carbs: 0, category: "vegetables" },
      ]),
    ).toBe("protein");
  });
  it("reads a stored column back as a symbol, unknown for null or anything stale", () => {
    expect(storedSymbol("bread")).toBe("bread");
    expect(storedSymbol(null)).toBe("unknown");
    expect(storedSymbol(undefined)).toBe("unknown");
    expect(storedSymbol("loaf")).toBe("unknown");
  });
  it("is exported from the package root", () => {
    expect(publicExports.mealSymbol).toBe(mealSymbol);
    expect(publicExports.storedSymbol).toBe(storedSymbol);
  });
});

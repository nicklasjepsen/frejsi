import { describe, expect, it } from "vitest";

import { PUMP_LOGGER_ID, mealLogger } from "./logger";

const owner = { id: "owner1", name: "Fictional owner" };

describe("mealLogger (#244)", () => {
  it("names the pump for an untouched pump meal, in da and en, and never the connecting owner", () => {
    expect(mealLogger({ source: "pump", byUser: owner }, "da")).toEqual({
      id: PUMP_LOGGER_ID,
      name: "Pumpen",
    });
    expect(mealLogger({ source: "pump", byUser: owner }, "en")).toEqual({
      id: PUMP_LOGGER_ID,
      name: "the pump",
    });
  });
  it("names the person for every other meal", () => {
    for (const source of [null, undefined, "import"])
      expect(mealLogger({ source, byUser: owner }, "da")).toEqual(owner);
  });
});

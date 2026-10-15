import { describe, expect, it } from "vitest";
import { foodSources } from "../registry";
import { OffSource } from "./source";
import { FridaSource } from "../frida/source";

describe("configured food plugins", () => {
  it("registers both plugins but enables neither implicitly", () => {
    expect(foodSources({})).toEqual([]);
    const sources = foodSources({
      FOOD_SOURCES: "off,frida",
      OFF_COUNTRY: "dk",
      APP_VERSION: "test",
    });
    expect(sources.map((source) => [source.id, source.kind])).toEqual([
      ["off", "remote"],
      ["frida", "local"],
    ]);
    expect(sources[0]).toBeInstanceOf(OffSource);
    expect(sources[1]).toBeInstanceOf(FridaSource);
    expect(foodSources({ FOOD_SOURCES: "frida" })).toHaveLength(1);
  });
});

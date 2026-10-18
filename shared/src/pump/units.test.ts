import { describe, expect, it } from "vitest";

import { formatUnits } from "./units";

describe("formatUnits (v0.7.0 plan §7)", () => {
  it("formats a number the pump recorded with the locale's decimal mark and unit letter", () => {
    expect(formatUnits(2.4, "da")).toBe("2,4 E");
    expect(formatUnits(1.25, "en")).toBe("1.25 U");
    expect(formatUnits(3, "da")).toBe("3 E");
    expect(formatUnits(3, "en")).toBe("3 U");
    expect(formatUnits(0.05, "da")).toBe("0,05 E");
    expect(formatUnits(0, "en")).toBe("0 U");
  });

  it("formats only: two decimals at most, never rounded up to a dose it did not record", () => {
    expect(formatUnits(2.4, "da")).not.toContain("2,40");
    expect(formatUnits(12.5, "en")).toBe("12.5 U");
  });
});

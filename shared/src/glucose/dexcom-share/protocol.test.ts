import { describe, expect, it } from "vitest";

import { parseDotNetDate, toTrend, windowFor } from "./protocol";

describe("Dexcom Share protocol helpers", () => {
  it("reads WT epoch values with or without an offset and the /Date()/ wrapper", () => {
    expect(parseDotNetDate("Date(1792058400000)").toISOString()).toBe("2026-10-15T10:00:00.000Z");
    expect(parseDotNetDate("Date(1792058400000+0200)").toISOString()).toBe(
      "2026-10-15T10:00:00.000Z",
    );
    expect(parseDotNetDate("/Date(1792058400000)/").toISOString()).toBe("2026-10-15T10:00:00.000Z");
    expect(() => parseDotNetDate("yesterday")).toThrow(RangeError);
  });

  it("maps every trend in both forms and falls back to not-computable", () => {
    expect(toTrend("DoubleUp")).toBe("double-up");
    expect(toTrend(1)).toBe("double-up");
    expect(toTrend("DoubleDown")).toBe("double-down");
    expect(toTrend(7)).toBe("double-down");
    expect(toTrend("NotComputable")).toBe("not-computable");
    expect(toTrend(8)).toBe("not-computable");
    expect(toTrend("RateOutOfRange")).toBe("rate-out-of-range");
    expect(toTrend(9)).toBe("rate-out-of-range");
    expect(toTrend("None")).toBe("not-computable");
    expect(toTrend(0)).toBe("not-computable");
    expect(toTrend("Sideways")).toBe("not-computable");
    expect(toTrend(42)).toBe("not-computable");
  });

  it("turns since into whole minutes, one reading per five, clamped to a day", () => {
    const now = new Date("2026-10-15T10:27:00.000Z");
    expect(windowFor(new Date("2026-10-15T09:57:00.000Z"), now)).toEqual({
      minutes: 30,
      maxCount: 6,
    });
    expect(windowFor(new Date("2026-10-15T10:26:30.000Z"), now)).toEqual({
      minutes: 1,
      maxCount: 1,
    });
    expect(windowFor(new Date("2026-10-14T10:27:00.000Z"), now)).toEqual({
      minutes: 1440,
      maxCount: 288,
    });
    expect(windowFor(new Date(0), now)).toEqual({ minutes: 1440, maxCount: 288 });
    expect(windowFor(new Date("2026-10-15T11:00:00.000Z"), now)).toEqual({
      minutes: 1,
      maxCount: 1,
    });
  });
});

import { describe, expect, it } from "vitest";

import { trendFromRate } from "./trend";

describe("trendFromRate", () => {
  it("draws Dexcom's arrows from a rate in mmol/L per minute, and not-computable without one", () => {
    expect(trendFromRate(null)).toBe("not-computable");
    expect(trendFromRate(Number.NaN)).toBe("not-computable");
    expect(trendFromRate(0)).toBe("flat");
    expect(trendFromRate(0.04)).toBe("flat");
    expect(trendFromRate(0.1)).toBe("forty-five-up");
    expect(trendFromRate(-0.1)).toBe("forty-five-down");
    expect(trendFromRate(0.14)).toBe("single-up");
    expect(trendFromRate(-0.14)).toBe("single-down");
    expect(trendFromRate(0.2)).toBe("double-up");
    expect(trendFromRate(-0.2)).toBe("double-down");
  });
});

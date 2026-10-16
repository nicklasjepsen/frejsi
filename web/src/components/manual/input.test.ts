import { describe, expect, it } from "vitest";

import { parseTyped, resolveTime } from "./input";

const COPENHAGEN = "Europe/Copenhagen";

describe("resolveTime", () => {
  it("takes today's time when it is not later than now", () => {
    const now = new Date("2026-10-14T13:13:00.000Z"); // 15:13
    expect(resolveTime("14:45", now, COPENHAGEN)?.toISOString()).toBe("2026-10-14T12:45:00.000Z");
  });

  it("takes yesterday's time when today's would be in the future", () => {
    const now = new Date("2026-10-14T13:13:00.000Z");
    expect(resolveTime("16:00", now, COPENHAGEN)?.toISOString()).toBe("2026-10-13T14:00:00.000Z");
  });

  it("finds yesterday across the spring-forward day, where 24 hours back is the day before", () => {
    // 00:30 on 30 March 2026, the morning after the 23-hour day.
    const now = new Date("2026-03-29T22:30:00.000Z");
    expect(resolveTime("23:00", now, COPENHAGEN)?.toISOString()).toBe("2026-03-29T21:00:00.000Z");
  });

  it("finds yesterday across the fall-back day", () => {
    const now = new Date("2026-10-25T23:30:00.000Z"); // 00:30 on the 26th, after a 25-hour day
    expect(resolveTime("23:00", now, COPENHAGEN)?.toISOString()).toBe("2026-10-25T22:00:00.000Z");
  });

  it("refuses a malformed time", () => {
    expect(resolveTime("", new Date(), COPENHAGEN)).toBeNull();
    expect(resolveTime("25:00", new Date(), COPENHAGEN)).toBeNull();
  });
});

describe("parseTyped", () => {
  it("takes a decimal comma or point for mmol/L and whole digits for mg/dL", () => {
    expect(parseTyped("6,2", "mmol")).toBe(6.2);
    expect(parseTyped(" 6.2 ", "mmol")).toBe(6.2);
    expect(parseTyped("112", "mgdl")).toBe(112);
    expect(parseTyped("6,2", "mgdl")).toBeNull();
  });

  it("refuses what is no glucose value", () => {
    for (const text of ["", "abc", "45", "0,5", "-6", "6,2,1", "1e2"]) {
      expect(parseTyped(text, "mmol"), text).toBeNull();
    }
    expect(parseTyped("900", "mgdl")).toBeNull();
  });
});

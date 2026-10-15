import { describe, expect, it } from "vitest";

import { formatClock } from "./time";

describe("formatClock", () => {
  it("renders HH:MM with a colon in every locale, as the artboards draw times", () => {
    const at = new Date("2026-10-14T12:05:00.000Z");
    expect(formatClock(at, "Europe/Copenhagen")).toBe("14:05");
    expect(formatClock(at, "UTC")).toBe("12:05");
    expect(formatClock(new Date("2026-10-14T23:30:00.000Z"), "Europe/Copenhagen")).toBe("01:30");
  });

  it("falls back to a dash for an invalid date", () => {
    expect(formatClock(new Date("nope"), "UTC")).toBe("–");
  });
});

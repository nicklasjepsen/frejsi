import { describe, expect, it } from "vitest";

import { DEMO_INTERVAL_MS, DEMO_LAG_MS, demoDirection, demoEntries, demoMgdl } from "./demo";

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("expected a value");
  return value;
}

const at = Date.UTC(2026, 10, 8, 12, 3, 30);

describe("the demo curve", () => {
  it("is a pure function of time: the same instant gives the same readings", () => {
    expect(demoEntries(at, 3)).toEqual(demoEntries(at, 3));
    expect(demoMgdl(at)).toBe(demoMgdl(at));
  });

  it("answers readings five minutes apart, newest first, the newest at least a minute old", () => {
    const entries = demoEntries(at, 3);
    expect(entries).toHaveLength(3);
    const [newest, second, third] = entries;
    expect(must(newest).date % DEMO_INTERVAL_MS).toBe(0);
    expect(at - must(newest).date).toBeGreaterThanOrEqual(DEMO_LAG_MS);
    expect(at - must(newest).date).toBeLessThan(DEMO_LAG_MS + DEMO_INTERVAL_MS);
    expect(must(newest).date - must(second).date).toBe(DEMO_INTERVAL_MS);
    expect(must(second).date - must(third).date).toBe(DEMO_INTERVAL_MS);
  });

  it("stays plausible over a day: 50-300 mg/dL, under 3 mg/dL a minute, some low and some high", () => {
    const day = Array.from({ length: 288 }, (_, i) => demoMgdl(at + i * DEMO_INTERVAL_MS));
    expect(Math.min(...day)).toBeGreaterThanOrEqual(50);
    expect(Math.max(...day)).toBeLessThanOrEqual(300);
    for (let i = 1; i < day.length; i += 1) {
      expect(Math.abs(must(day[i]) - must(day[i - 1])) / 5).toBeLessThan(3);
    }
    expect(day.some((v) => v < 80)).toBe(true);
    expect(day.some((v) => v > 180)).toBe(true);
    expect(day.some((v) => v >= 80 && v <= 180)).toBe(true);
  });

  it("names Nightscout's direction words by the five-minute change", () => {
    expect(demoDirection(0)).toBe("Flat");
    expect(demoDirection(7)).toBe("FortyFiveUp");
    expect(demoDirection(12)).toBe("SingleUp");
    expect(demoDirection(20)).toBe("DoubleUp");
    expect(demoDirection(-7)).toBe("FortyFiveDown");
    expect(demoDirection(-12)).toBe("SingleDown");
    expect(demoDirection(-20)).toBe("DoubleDown");
  });
});

import { describe, expect, it } from "vitest";

import { Reading } from "../schemas/glucose";
import { FakeGlucoseSource } from "./fake";
import type { GlucoseSource } from "./types";

const now = new Date("2026-10-15T12:00:00.000Z");

describe("FakeGlucoseSource", () => {
  it("satisfies GlucoseSource", () => {
    const source: GlucoseSource = new FakeGlucoseSource({ now: () => now });
    expect(typeof source.fetchSince).toBe("function");
    expect(typeof source.probe).toBe("function");
  });

  it("probes ok", async () => {
    await expect(new FakeGlucoseSource({ now: () => now }).probe()).resolves.toBe("ok");
  });

  it("returns one valid reading per five minutes since the given time, oldest first", async () => {
    const source = new FakeGlucoseSource({ now: () => now });
    const readings = await source.fetchSince(new Date("2026-10-15T11:30:00.000Z"));
    expect(readings).toHaveLength(6);
    for (const reading of readings) {
      expect(Reading.safeParse(reading).success).toBe(true);
      expect(reading.mmol).toBeGreaterThanOrEqual(3);
      expect(reading.mmol).toBeLessThanOrEqual(15);
    }
    const times = readings.map((r) => Date.parse(r.ts));
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(times[0]).toBeGreaterThan(Date.parse("2026-10-15T11:30:00.000Z"));
    expect(times.at(-1)).toBeLessThanOrEqual(now.getTime());
  });

  it("is deterministic: the same clock gives the same readings", async () => {
    const since = new Date("2026-10-15T00:00:00.000Z");
    const a = await new FakeGlucoseSource({ now: () => now }).fetchSince(since);
    const b = await new FakeGlucoseSource({ now: () => now }).fetchSince(since);
    expect(a).toEqual(b);
    expect(a).toHaveLength(144);
  });

  it("returns nothing when nothing is newer than since", async () => {
    const source = new FakeGlucoseSource({ now: () => now });
    await expect(source.fetchSince(now)).resolves.toEqual([]);
  });

  it("moves: the trend is not flat all day", async () => {
    const source = new FakeGlucoseSource({ now: () => now });
    const readings = await source.fetchSince(new Date("2026-10-15T00:00:00.000Z"));
    const trends = new Set(readings.map((r) => r.trend));
    expect(trends.size).toBeGreaterThan(1);
    expect(trends.has("flat")).toBe(true);
  });
});

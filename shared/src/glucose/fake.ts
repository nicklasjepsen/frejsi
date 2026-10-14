import type { ProbeResult, Reading, Trend } from "../schemas/glucose";
import type { GlucoseSource } from "./types";

const FIVE_MINUTES = 5 * 60 * 1000;

/** Dexcom's trend thresholds in mg/dL per minute, converted to mmol/L per minute. */
function trendFromSlope(mmolPerMinute: number): Trend {
  const mgdlPerMinute = mmolPerMinute * 18.016;
  const magnitude = Math.abs(mgdlPerMinute);
  if (magnitude < 1) return "flat";
  if (magnitude < 2) return mgdlPerMinute > 0 ? "forty-five-up" : "forty-five-down";
  if (magnitude < 3) return mgdlPerMinute > 0 ? "single-up" : "single-down";
  return mgdlPerMinute > 0 ? "double-up" : "double-down";
}

/** A smooth, synthetic day: nothing here is a real person's trace. */
function curve(epochMs: number): number {
  const minutes = epochMs / 60000;
  const slow = 2.4 * Math.sin((2 * Math.PI * minutes) / 240);
  const fast = 0.9 * Math.sin((2 * Math.PI * minutes) / 55 + 1);
  return 7.2 + slow + fast;
}

export interface FakeGlucoseSourceOptions {
  /** The clock, so tests are deterministic. */
  now?: () => Date;
}

/**
 * Deterministic readings every five minutes, for local development (`FAKE_GLUCOSE_SOURCE=1`),
 * the seed and tests. The lint boundary keeps it out of production code.
 */
export class FakeGlucoseSource implements GlucoseSource {
  private readonly now: () => Date;

  constructor(options: FakeGlucoseSourceOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  fetchSince(since: Date): Promise<Reading[]> {
    const end = this.now().getTime();
    const readings: Reading[] = [];
    let t = Math.floor(since.getTime() / FIVE_MINUTES) * FIVE_MINUTES + FIVE_MINUTES;
    for (; t <= end; t += FIVE_MINUTES) {
      const mmol = Math.round(curve(t) * 10) / 10;
      const slope = (curve(t) - curve(t - FIVE_MINUTES)) / 5;
      readings.push({ ts: new Date(t).toISOString(), mmol, trend: trendFromSlope(slope) });
    }
    return Promise.resolve(readings);
  }

  probe(): Promise<ProbeResult> {
    return Promise.resolve("ok");
  }
}

import type { ProbeResult, Reading } from "../schemas/glucose";
import { trendFromRate } from "./import/trend";
import type { GlucoseSource } from "./types";

const FIVE_MINUTES = 5 * 60 * 1000;
/** Like a real adapter's `maxCount`: a day is the most one call returns, however old `since` is. */
const MAX_WINDOW_MS = 24 * 60 * 60 * 1000;

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
    const start = Math.max(since.getTime(), end - MAX_WINDOW_MS);
    const readings: Reading[] = [];
    let t = Math.floor(start / FIVE_MINUTES) * FIVE_MINUTES + FIVE_MINUTES;
    for (; t <= end; t += FIVE_MINUTES) {
      const mmol = Math.round(curve(t) * 10) / 10;
      const slope = (curve(t) - curve(t - FIVE_MINUTES)) / 5;
      readings.push({ ts: new Date(t).toISOString(), mmol, trend: trendFromRate(slope) });
    }
    return Promise.resolve(readings);
  }

  probe(): Promise<ProbeResult> {
    return Promise.resolve("ok");
  }
}

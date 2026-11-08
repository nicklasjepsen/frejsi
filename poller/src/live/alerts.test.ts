import { describe, expect, it } from "vitest";

import { ALERT_REPEAT_MS, decideAlert, STALE_ALERT_AFTER_MS, type AlertState } from "./alerts";

const now = Date.UTC(2026, 10, 8, 12, 0, 0);
const min = 60_000;
const state = (fields: Partial<AlertState> = {}): AlertState => ({
  alertsOn: true,
  deviceToken: "ab".repeat(32),
  lowMgdl: 80,
  highMgdl: 180,
  lastAlertKind: null,
  lastAlertAt: null,
  ...fields,
});
const reading = (mgdl: number, ageMin = 2) => ({ date: now - ageMin * min, mgdl });

describe("the low/high reminder's repeat rules", () => {
  it("alerts once when a reading crosses below low or above high", () => {
    expect(decideAlert(state(), reading(70), now - 2 * min, now)).toEqual({ send: "low" });
    expect(decideAlert(state(), reading(200), now - 2 * min, now)).toEqual({ send: "high" });
    // On the line is in range.
    expect(decideAlert(state(), reading(80), now - 2 * min, now)).toBeNull();
    expect(decideAlert(state(), reading(180), now - 2 * min, now)).toBeNull();
  });

  it("does not repeat within 30 minutes while still out of range, then does", () => {
    const sent = state({ lastAlertKind: "low", lastAlertAt: new Date(now - 10 * min) });
    expect(decideAlert(sent, reading(70), now - 2 * min, now)).toBeNull();
    const old = state({ lastAlertKind: "low", lastAlertAt: new Date(now - ALERT_REPEAT_MS) });
    expect(decideAlert(old, reading(70), now - 2 * min, now)).toEqual({ send: "low" });
  });

  it("alerts at once when low turns high, and resets when the reading is back in range", () => {
    const low = state({ lastAlertKind: "low", lastAlertAt: new Date(now - min) });
    expect(decideAlert(low, reading(250), now - 2 * min, now)).toEqual({ send: "high" });
    expect(decideAlert(low, reading(120), now - 2 * min, now)).toEqual({ reset: true });
  });

  it("sends one no-new-readings alert at 20 minutes, and not again", () => {
    const at = now - STALE_ALERT_AFTER_MS;
    expect(decideAlert(state(), undefined, at, now)).toEqual({ send: "stale" });
    expect(decideAlert(state(), reading(120, 20), at, now)).toEqual({ send: "stale" });
    expect(decideAlert(state(), undefined, at + 1, now)).toBeNull();
    const sent = state({ lastAlertKind: "stale", lastAlertAt: new Date(now - 60 * min) });
    expect(decideAlert(sent, undefined, now - 90 * min, now)).toBeNull();
    // Readings come back out of range: that is a new crossing.
    expect(decideAlert(sent, reading(70), now - 2 * min, now)).toEqual({ send: "low" });
  });

  it("is silent when alerts are off, without a device token, or before any reading", () => {
    expect(decideAlert(state({ alertsOn: false }), reading(60), now - 2 * min, now)).toBeNull();
    expect(decideAlert(state({ deviceToken: null }), reading(60), now - 2 * min, now)).toBeNull();
    expect(decideAlert(state(), undefined, null, now)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";

import {
  BACKOFF_EVERY_MS,
  FIRST_CHECK_AFTER_MS,
  nextCheckAt,
  RESTART_AFTER_MS,
  restartIsDue,
  RETRY_EVERY_MS,
} from "./schedule";

const reading = Date.UTC(2026, 10, 8, 12, 0, 0);
const min = 60_000;

describe("when a subscription is next due", () => {
  it("is the newest reading + 5 min 15 s while that is still ahead", () => {
    expect(FIRST_CHECK_AFTER_MS).toBe(5 * min + 15_000);
    expect(nextCheckAt(reading + 30_000, { newestReadingAt: reading, restartFrom: null })).toBe(
      reading + FIRST_CHECK_AFTER_MS,
    );
  });

  it("is every minute after that while no new reading has come", () => {
    const now = reading + 6 * min;
    expect(nextCheckAt(now, { newestReadingAt: reading, restartFrom: null })).toBe(
      now + RETRY_EVERY_MS,
    );
    const later = reading + 19 * min + 59_000;
    expect(nextCheckAt(later, { newestReadingAt: reading, restartFrom: null })).toBe(later + min);
  });

  it("backs off to every five minutes once the newest reading is 20 minutes old", () => {
    const now = reading + 20 * min;
    expect(nextCheckAt(now, { newestReadingAt: reading, restartFrom: null })).toBe(
      now + BACKOFF_EVERY_MS,
    );
  });

  it("waits five minutes when there has never been a reading", () => {
    expect(nextCheckAt(reading, { newestReadingAt: null, restartFrom: null })).toBe(
      reading + 5 * min,
    );
  });

  it("comes early for an activity that reaches 7 h 45 min first", () => {
    expect(RESTART_AFTER_MS).toBe((7 * 60 + 45) * min);
    const started = reading - RESTART_AFTER_MS + 2 * min;
    expect(nextCheckAt(reading + 30_000, { newestReadingAt: reading, restartFrom: started })).toBe(
      started + RESTART_AFTER_MS,
    );
    // An overdue restart is retried a minute on, never in the past.
    const overdue = reading - RESTART_AFTER_MS - 10 * min;
    expect(nextCheckAt(reading, { newestReadingAt: reading, restartFrom: overdue })).toBe(
      reading + min,
    );
  });

  it("calls a restart due at 7 h 45 min, not before", () => {
    expect(restartIsDue(reading + RESTART_AFTER_MS, reading)).toBe(true);
    expect(restartIsDue(reading + RESTART_AFTER_MS - 1, reading)).toBe(false);
  });
});

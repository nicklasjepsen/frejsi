import { describe, expect, it } from "vitest";
import { instantOfLocalTime, localClock } from "./time";

const zone = "Europe/Copenhagen";
describe("the sheet's time field", () => {
  it("places HH:MM on today's local date in the space's zone", () => {
    const now = new Date("2026-10-15T13:00:00.000Z"); // 15:00 CEST
    expect(instantOfLocalTime("14:30", zone, now)?.toISOString()).toBe("2026-10-15T12:30:00.000Z");
    expect(localClock(now, zone)).toBe("15:00");
  });
  it("takes a time more than ten minutes ahead as yesterday's", () => {
    const now = new Date("2026-10-15T22:10:00.000Z"); // 00:10 CEST on the 16th
    expect(instantOfLocalTime("23:50", zone, now)?.toISOString()).toBe("2026-10-15T21:50:00.000Z");
    expect(instantOfLocalTime("00:15", zone, now)?.toISOString()).toBe("2026-10-15T22:15:00.000Z");
    expect(instantOfLocalTime("00:30", zone, now)?.toISOString()).toBe("2026-10-14T22:30:00.000Z");
  });
  it("handles the day daylight saving ends and refuses nonsense", () => {
    const now = new Date("2026-10-25T12:00:00.000Z"); // 13:00 CET, after the change at 03:00
    expect(instantOfLocalTime("01:30", zone, now)?.toISOString()).toBe("2026-10-24T23:30:00.000Z");
    expect(instantOfLocalTime("09:00", zone, now)?.toISOString()).toBe("2026-10-25T08:00:00.000Z");
    expect(instantOfLocalTime("25:00", zone, now)).toBeNull();
    expect(instantOfLocalTime("9:00", zone, now)).toBeNull();
  });
});

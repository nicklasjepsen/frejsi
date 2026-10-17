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
  it("resolves yesterday on its own offset across the clock change", () => {
    // 03:10 CET on 25 October, two hours after summer time ended; 23:50 yesterday was CEST.
    const after = new Date("2026-10-25T02:10:00.000Z");
    expect(instantOfLocalTime("23:50", zone, after)?.toISOString()).toBe("2026-10-24T21:50:00.000Z");
    // 03:10 CEST on 29 March, after the spring change; 23:50 yesterday was CET.
    const spring = new Date("2026-03-29T01:10:00.000Z");
    expect(instantOfLocalTime("23:50", zone, spring)?.toISOString()).toBe("2026-03-28T22:50:00.000Z");
  });
  it("picks the occurrence that has passed in the hour that repeats when summer time ends", () => {
    // 02:15 CEST on 25 October, the first pass through the repeated hour: 02:10 was five minutes ago.
    const first = new Date("2026-10-25T00:15:00.000Z");
    expect(instantOfLocalTime("02:10", zone, first)?.toISOString()).toBe("2026-10-25T00:10:00.000Z");
    // 02:15 CET, the second pass: 02:10 is again five minutes ago, and 02:50 is the first pass's.
    const second = new Date("2026-10-25T01:15:00.000Z");
    expect(instantOfLocalTime("02:10", zone, second)?.toISOString()).toBe("2026-10-25T01:10:00.000Z");
    expect(instantOfLocalTime("02:50", zone, second)?.toISOString()).toBe("2026-10-25T00:50:00.000Z");
    // 02:30 on 29 March does not exist; it lands on the clock after the jump, as the field means it.
    const gap = new Date("2026-03-29T10:00:00.000Z");
    expect(instantOfLocalTime("02:30", zone, gap)?.toISOString()).toBe("2026-03-29T01:30:00.000Z");
  });
  it("handles the day daylight saving ends and refuses nonsense", () => {
    const now = new Date("2026-10-25T12:00:00.000Z"); // 13:00 CET, after the change at 03:00
    expect(instantOfLocalTime("01:30", zone, now)?.toISOString()).toBe("2026-10-24T23:30:00.000Z");
    expect(instantOfLocalTime("09:00", zone, now)?.toISOString()).toBe("2026-10-25T08:00:00.000Z");
    expect(instantOfLocalTime("25:00", zone, now)).toBeNull();
    expect(instantOfLocalTime("9:00", zone, now)).toBeNull();
  });
});

// @vitest-environment node
import { describe, expect, it } from "vitest";

import { CURSOR_ONLY_SINCE, SinceSeq } from "./contracts";
import { loadEventsPage } from "./server";
import { FakeLiveDb } from "./test-support";

const T0 = new Date("2026-10-15T11:13:00.000Z");

describe("loadEventsPage past the end of the log", () => {
  it("answers the space's cursor and no events, so a feed without readings knows where to start", async () => {
    const fake = new FakeLiveDb(() => T0);
    fake.addSpace("s1");
    fake.addEvent("s1", "member.joined", { userId: "viewer-1", role: "viewer" });
    fake.addReading("s1", { ts: T0.toISOString(), mmol: 6.2, trend: "flat" });
    expect(SinceSeq.safeParse(String(CURSOR_ONLY_SINCE)).success).toBe(true);
    for (const role of ["viewer", "owner"] as const) {
      expect(await loadEventsPage("s1", CURSOR_ONLY_SINCE, role, fake.db)).toEqual({
        lastSeq: 2,
        events: [],
        more: false,
      });
    }
    expect(await loadEventsPage("s1", 2, "owner", fake.db)).toEqual({
      lastSeq: 2,
      events: [],
      more: false,
    });
  });
});

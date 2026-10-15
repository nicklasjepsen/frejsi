// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EVENTS_PAGE_SIZE, type EventsPage } from "@/lib/live/contracts";
import { configureLive } from "@/lib/live/server";
import { captureLog, FakeLiveDb, liveRequest, spaceContext } from "@/lib/live/test-support";

import { GET } from "./route";

const T0 = new Date("2026-10-15T13:13:00.000Z");

let fake: FakeLiveDb;
let logs: ReturnType<typeof captureLog>;

beforeEach(() => {
  fake = new FakeLiveDb(() => T0);
  fake.addSpace("s1");
  fake.addMember("owner-1", "s1", "owner");
  fake.addMember("viewer-1", "s1", "viewer");
  fake.addSpace("s2");
  fake.addMember("other-1", "s2", "owner");
  // seq 1: a reading, 2: the source came up, 3: another reading, 4: a member joined.
  fake.addReading("s1", { ts: "2026-10-15T13:05:00.000Z", mmol: 6.1, trend: "flat" });
  fake.addEvent("s1", "source.status", { status: "connected", since: T0.toISOString() });
  fake.addReading("s1", { ts: "2026-10-15T13:10:00.000Z", mmol: 6.2, trend: "forty-five-up" });
  fake.addEvent("s1", "member.joined", { userId: "carer-9", role: "carer" });
  configureLive({ db: fake.db, now: () => T0 });
  logs = captureLog();
});
afterEach(() => {
  vi.restoreAllMocks();
  configureLive({});
});

const events = async (sessionId: string | null, since?: string, spaceId = "s1") => {
  const res = await GET(
    liveRequest(spaceId, "events", sessionId, since === undefined ? {} : { since }),
    spaceContext(spaceId),
  );
  return { res, page: res.status === 200 ? ((await res.json()) as EventsPage) : null };
};

describe("GET /api/spaces/:id/events?since= (plan §5)", () => {
  it("returns the events after `since` in order with the cursor to continue from", async () => {
    const { res, page } = await events("sess-owner-1", "1");
    expect(res.status).toBe(200);
    expect(page?.events.map((e) => [e.seq, e.type])).toEqual([
      [2, "source.status"],
      [3, "reading"],
      [4, "member.joined"],
    ]);
    expect(page?.lastSeq).toBe(4);
    expect(page?.more).toBe(false);
    expect(page?.events[1]).toMatchObject({
      payload: { ts: "2026-10-15T13:10:00.000Z", mmol: 6.2, trend: "forty-five-up" },
    });
  });

  it("starts from the beginning without `since` and is empty when nothing is new", async () => {
    expect((await events("sess-owner-1")).page?.events.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
    const caughtUp = (await events("sess-owner-1", "4")).page;
    expect(caughtUp).toEqual({ lastSeq: 4, events: [], more: false });
  });

  it("carries no reading for a viewer and still moves the cursor past them", async () => {
    const { res, page } = await events("sess-viewer-1", "0");
    expect(res.status).toBe(200);
    expect(page?.events.map((e) => e.type)).toEqual(["source.status", "member.joined"]);
    expect(page?.events.some((e) => e.type === "reading")).toBe(false);
    expect(JSON.stringify(page)).not.toContain("mmol");
    expect(page?.lastSeq).toBe(4);

    // An import's event is about glucose too: the owner hears it, the viewer never does.
    fake.addEvent("s1", "readings.imported", {
      count: 12,
      from: T0.toISOString(),
      to: T0.toISOString(),
    });
    expect((await events("sess-owner-1", "4")).page?.events.map((e) => e.type)).toEqual([
      "readings.imported",
    ]);
    expect((await events("sess-viewer-1", "4")).page).toEqual({
      lastSeq: 5,
      events: [],
      more: false,
    });

    // Only readings after the cursor: the viewer's page is empty but the cursor still advances.
    fake.addReading("s1", { ts: "2026-10-15T13:15:00.000Z", mmol: 6.4, trend: "flat" });
    const next = (await events("sess-viewer-1", "5")).page;
    expect(next).toEqual({ lastSeq: 6, events: [], more: false });
  });

  it("never moves the cursor past an event committed while the page was being read", async () => {
    // Between reading the space's lastSeq (4) and the rows, a reading and a member event commit.
    fake.duringEventQuery = () => {
      fake.duringEventQuery = null;
      fake.addReading("s1", { ts: "2026-10-15T13:15:00.000Z", mmol: 6.4, trend: "flat" });
      fake.addEvent("s1", "member.joined", { userId: "carer-10", role: "carer" });
    };
    const first = (await events("sess-viewer-1", "0")).page;
    expect(first?.events.map((e) => e.seq)).toEqual([2, 4]);
    expect(first?.lastSeq).toBe(4);
    const second = (await events("sess-viewer-1", "4")).page;
    expect(second?.events.map((e) => [e.seq, e.type])).toEqual([[6, "member.joined"]]);
    expect(second?.lastSeq).toBe(6);
  });

  it("pages at EVENTS_PAGE_SIZE and says there is more", async () => {
    for (let i = 0; i < EVENTS_PAGE_SIZE; i += 1) {
      fake.addEvent("s1", "member.updated", { userId: "owner-1" });
    }
    const first = (await events("sess-owner-1", "0")).page;
    expect(first?.events).toHaveLength(EVENTS_PAGE_SIZE);
    expect(first?.more).toBe(true);
    expect(first?.lastSeq).toBe(EVENTS_PAGE_SIZE);
    const second = (await events("sess-owner-1", String(first?.lastSeq))).page;
    expect(second?.events.map((e) => e.seq)).toEqual([
      EVENTS_PAGE_SIZE + 1,
      EVENTS_PAGE_SIZE + 2,
      EVENTS_PAGE_SIZE + 3,
      EVENTS_PAGE_SIZE + 4,
    ]);
    expect(second?.more).toBe(false);
  });

  it("answers 400 for a bad `since`, 404 for a non-member and 403 without a session", async () => {
    expect((await events("sess-owner-1", "abc")).res.status).toBe(400);
    expect((await events("sess-owner-1", "-1")).res.status).toBe(400);
    expect((await events("sess-owner-1", "1.5")).res.status).toBe(400);
    expect((await events("sess-other-1", "0")).res.status).toBe(404);
    expect((await events(null, "0")).res.status).toBe(403);
  });

  it("logs the space, the user and a count, never a reading value", async () => {
    await events("sess-owner-1", "0");
    await events("sess-other-1", "0");
    const all = logs.all();
    expect(logs.lines.length).toBeGreaterThan(0);
    expect(all).toContain('"spaceId":"s1"');
    expect(all).toContain('"userId":"owner-1"');
    expect(all).toContain('"count":4');
    expect(all).not.toContain("6.1");
    expect(all).not.toContain("6.2");
    expect(all).not.toContain("mmol");
    expect(all).not.toContain("Member owner-1");
  });
});

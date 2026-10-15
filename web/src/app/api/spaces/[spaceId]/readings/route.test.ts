// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ReadingsWindow } from "@/lib/live/contracts";
import { configureLive } from "@/lib/live/server";
import { captureLog, FakeLiveDb, liveRequest, spaceContext } from "@/lib/live/test-support";

import { GET } from "./route";

const T0 = new Date("2026-10-15T13:13:00.000Z");
const hoursAgo = (h: number) => new Date(T0.getTime() - h * 60 * 60 * 1000).toISOString();

let fake: FakeLiveDb;
let logs: ReturnType<typeof captureLog>;

beforeEach(() => {
  fake = new FakeLiveDb(() => T0);
  fake.addSpace("s1", {
    glucoseSource: JSON.stringify({ type: "dexcom-share", region: "eu", secretRef: "glucose-s1" }),
    sourceStatus: "connected",
  });
  fake.addMember("owner-1", "s1", "owner");
  fake.addMember("carer-1", "s1", "carer");
  fake.addMember("viewer-1", "s1", "viewer");
  fake.addSpace("s2");
  fake.addMember("other-1", "s2", "owner");
  fake.addReading("s1", { ts: hoursAgo(26), mmol: 7.7, trend: "flat" });
  fake.addReading("s1", { ts: hoursAgo(5), mmol: 5.5, trend: "flat" });
  fake.addEvent("s1", "source.status", { status: "connected", since: hoursAgo(4) });
  fake.addReading("s1", { ts: hoursAgo(2), mmol: 6.1, trend: "single-up" });
  fake.addReading("s1", { ts: "2026-10-15T13:10:00.000Z", mmol: 6.2, trend: "forty-five-up" });
  configureLive({ db: fake.db, now: () => T0 });
  logs = captureLog();
});
afterEach(() => {
  vi.restoreAllMocks();
  configureLive({});
});

const readings = async (sessionId: string | null, hours?: string, spaceId = "s1") => {
  const res = await GET(
    liveRequest(spaceId, "readings", sessionId, hours === undefined ? {} : { hours }),
    spaceContext(spaceId),
  );
  return { res, body: res.status === 200 ? ((await res.json()) as ReadingsWindow) : null };
};

describe("GET /api/spaces/:id/readings?hours= (plan §5)", () => {
  it("is 403 for a viewer, in the API, whatever the UI does", async () => {
    const { res } = await readings("sess-viewer-1", "3");
    expect(res.status).toBe(403);
    const text = JSON.stringify(await res.json());
    expect(text).toMatchObject(expect.not.stringContaining("mmol"));
    expect(text).not.toContain("6.2");
  });

  it("returns the window with every reading carrying its ts, the cursor and the space settings", async () => {
    const { res, body } = await readings("sess-owner-1", "3");
    expect(res.status).toBe(200);
    expect(body?.readings).toEqual([
      { ts: hoursAgo(2), mmol: 6.1, trend: "single-up" },
      { ts: "2026-10-15T13:10:00.000Z", mmol: 6.2, trend: "forty-five-up" },
    ]);
    for (const reading of body?.readings ?? []) expect(reading.ts).toMatch(/T/);
    expect(body?.lastSeq).toBe(5);
    expect(body?.sourceStatus).toBe("connected");
    expect(body?.sourceSince).toBe(hoursAgo(4));
    expect(body?.space).toEqual({
      glucoseUnit: "mmol",
      targetLow: 4,
      targetHigh: 10,
      timezone: "Europe/Copenhagen",
      sourceType: "dexcom-share",
    });
  });

  it("defaults to 24 hours and lets a carer read too", async () => {
    const { body } = await readings("sess-carer-1");
    expect(body?.readings.map((r) => r.mmol)).toEqual([5.5, 6.1, 6.2]);
  });

  it("answers 400 outside 1..24 hours, 404 for a non-member and 403 without a session", async () => {
    expect((await readings("sess-owner-1", "0")).res.status).toBe(400);
    expect((await readings("sess-owner-1", "25")).res.status).toBe(400);
    expect((await readings("sess-owner-1", "three")).res.status).toBe(400);
    expect((await readings("sess-other-1", "3")).res.status).toBe(404);
    expect((await readings(null, "3")).res.status).toBe(403);
  });

  it("logs the space, the user and a count, never a reading value", async () => {
    await readings("sess-owner-1", "3");
    await readings("sess-viewer-1", "3");
    const all = logs.all();
    expect(logs.lines.length).toBeGreaterThan(0);
    expect(all).toContain('"spaceId":"s1"');
    expect(all).toContain('"userId":"owner-1"');
    expect(all).toContain('"count":2');
    expect(all).toContain('"code":"forbidden"');
    expect(all).not.toContain("6.1");
    expect(all).not.toContain("6.2");
    expect(all).not.toContain("mmol");
    expect(all).not.toContain("Member owner-1");
  });
});

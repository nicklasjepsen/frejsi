// @vitest-environment node
import { PumpHistoryView } from "@frejsi/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { captureLog, FakeLiveDb, liveRequest, spaceContext } from "@/lib/live/test-support";
import { configurePump } from "@/lib/pump/server";
import { FakePumpDb } from "@/lib/pump/test-support";

import { GET } from "./route";

const T0 = new Date("2026-10-15T13:13:00.000Z");
const FROM = "2026-10-14T22:00:00.000Z";
const TO = "2026-10-15T22:00:00.000Z";

let auth: FakeLiveDb;
let pump: FakePumpDb;
let logs: ReturnType<typeof captureLog>;

beforeEach(() => {
  auth = new FakeLiveDb(() => T0);
  auth.addSpace("s1");
  auth.addMember("owner-1", "s1", "owner");
  auth.addMember("carer-1", "s1", "carer");
  auth.addMember("child-1", "s1", "carer");
  auth.addMember("viewer-1", "s1", "viewer");
  auth.addMember("other-1", "s2", "owner");
  const child = auth.users.find((u) => u.id === "child-1");
  if (child) child.simpleMode = true;
  pump = new FakePumpDb();
  pump.addSpace({
    id: "s1",
    pumpStatus: "connected",
    lastPumpAt: new Date("2026-10-15T11:58:00.000Z"),
  });
  pump.addBolus("s1", {
    id: "b2",
    ts: "2026-10-15T11:58:00.000Z",
    units: "2.4",
    kind: "standard",
    carbs: 45,
  });
  pump.addBolus("s1", {
    id: "b1",
    ts: "2026-10-15T03:10:00.000Z",
    units: "0.6",
    kind: "automatic",
  });
  pump.link("meal-lunch", "b2", "2026-10-15T12:05:00.000Z");
  configurePump({ db: pump.db, sessionDb: auth.db, now: () => T0 });
  logs = captureLog();
});
afterEach(() => {
  vi.restoreAllMocks();
  configurePump({});
});

const read = async (
  sessionId: string | null,
  query: Record<string, string> = { from: FROM, to: TO },
  spaceId = "s1",
) => {
  const res = await GET(liveRequest(spaceId, "pump", sessionId, query), spaceContext(spaceId));
  const body: unknown = await res.json();
  return { res, body };
};

describe("GET /api/spaces/:id/pump?from&to (v0.7.0 plan §4)", () => {
  it("gives an owner the boluses oldest first with the meal link, the reach and the status", async () => {
    const { res, body } = await read("sess-owner-1");
    expect(res.status).toBe(200);
    expect(PumpHistoryView.parse(body)).toEqual({
      boluses: [
        { id: "b1", ts: "2026-10-15T03:10:00.000Z", units: 0.6, kind: "automatic" },
        {
          id: "b2",
          ts: "2026-10-15T11:58:00.000Z",
          units: 2.4,
          kind: "standard",
          carbs: 45,
          mealId: "meal-lunch",
        },
      ],
      reach: "2026-10-15T11:58:00.000Z",
      status: "connected",
    });
  });

  it("gives a carer the same view", async () => {
    const { res, body } = await read("sess-carer-1");
    expect(res.status).toBe(200);
    expect((body as PumpHistoryView).boluses.map((b) => b.id)).toEqual(["b1", "b2"]);
  });

  it("is 403 for a viewer, in the API, and carries nothing of the pump", async () => {
    const { res, body } = await read("sess-viewer-1");
    expect(res.status).toBe(403);
    const text = JSON.stringify(body);
    expect(text).not.toContain("2.4");
    expect(text).not.toContain("bolus");
    expect(text).not.toContain("11:58");
  });

  it("is 403 for a simpleMode session, in the API, whatever the role", async () => {
    const { res, body } = await read("sess-child-1");
    expect(res.status).toBe(403);
    expect(JSON.stringify(body)).not.toContain("2.4");
  });

  it("is 400 for a range over 8 days, a missing bound or from after to", async () => {
    expect(
      (
        await read("sess-owner-1", {
          from: "2026-10-01T00:00:00.000Z",
          to: "2026-10-09T00:00:01.000Z",
        })
      ).res.status,
    ).toBe(400);
    expect(
      (
        await read("sess-owner-1", {
          from: "2026-10-01T00:00:00.000Z",
          to: "2026-10-09T00:00:00.000Z",
        })
      ).res.status,
    ).toBe(200);
    expect((await read("sess-owner-1", { from: FROM })).res.status).toBe(400);
    expect((await read("sess-owner-1", { from: TO, to: FROM })).res.status).toBe(400);
    expect((await read("sess-owner-1", { from: "yesterday", to: TO })).res.status).toBe(400);
  });

  it("judges the role before the range, so a viewer learns nothing from a 400", async () => {
    expect((await read("sess-viewer-1", { from: "x", to: "y" })).res.status).toBe(403);
    expect((await read("sess-child-1", { from: "x", to: "y" })).res.status).toBe(403);
  });

  it("is 404 for a non-member and 403 without a session", async () => {
    expect((await read("sess-other-1")).res.status).toBe(404);
    expect((await read(null)).res.status).toBe(403);
  });

  it("logs the space, the user and a count, never units, carbs or a time", async () => {
    await read("sess-owner-1");
    await read("sess-viewer-1");
    const all = logs.all();
    expect(all).toContain('"spaceId":"s1"');
    expect(all).toContain('"userId":"owner-1"');
    expect(all).toContain('"count":2');
    expect(all).toContain('"code":"forbidden"');
    expect(all).not.toContain("2.4");
    expect(all).not.toContain("0.6");
    expect(all).not.toContain("45");
    expect(all).not.toContain("11:58");
  });
});

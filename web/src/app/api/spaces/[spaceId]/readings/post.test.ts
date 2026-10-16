// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as eventsGet } from "../events/route";
import { configureLive } from "@/lib/live/server";
import type { EventsPage } from "@/lib/live/contracts";
import { captureLog, FakeLiveDb, liveRequest, spaceContext } from "@/lib/live/test-support";
import { configureReadings } from "@/lib/readings/service";
import { ReadingsFake } from "@/lib/readings/test-support";

import { POST } from "./route";

const T0 = new Date("2026-10-15T13:13:00.000Z");
const minutesAgo = (m: number) => new Date(T0.getTime() - m * 60 * 1000).toISOString();
const MANUAL = JSON.stringify({ type: "manual" });

let live: FakeLiveDb;
let fake: ReadingsFake;
let tracked: [string, Record<string, string> | undefined][];
let logs: ReturnType<typeof captureLog>;

beforeEach(() => {
  live = new FakeLiveDb(() => T0);
  live.addSpace("s1", { glucoseSource: MANUAL, lastReadingAt: null });
  live.addSpace("sx", {
    glucoseSource: JSON.stringify({ type: "dexcom-share", region: "eu", secretRef: "g" }),
  });
  live.addSpace("sn", { glucoseSource: JSON.stringify({ type: "nightscout", secretRef: "g" }) });
  for (const id of ["sx", "sn"]) live.addMember("owner-1", id, "owner");
  live.addMember("owner-1", "s1", "owner");
  live.addMember("carer-1", "s1", "carer");
  live.addMember("viewer-1", "s1", "viewer");
  live.addMember("child-1", "s1", "carer");
  const child = live.users.find((u) => u.id === "child-1");
  if (child) child.simpleMode = true;
  live.addSpace("s2");
  live.addMember("other-1", "s2", "owner");
  fake = new ReadingsFake(live);
  tracked = [];
  configureLive({ db: live.db, now: () => T0 });
  configureReadings({
    db: fake.db,
    sink: fake.sink,
    now: () => T0,
    track: (name, props) => tracked.push([name, props]),
  });
  logs = captureLog();
});
afterEach(() => {
  vi.restoreAllMocks();
  configureLive({});
  configureReadings({});
});

const post = (sessionId: string | null, body: unknown, spaceId = "s1") =>
  POST(
    new Request(`https://frejsi.example/api/spaces/${spaceId}/readings`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(sessionId ? { cookie: `frejsi_session=${sessionId}` } : {}),
      },
      body: JSON.stringify(body),
    }),
    spaceContext(spaceId),
  );
const error = async (res: Response) =>
  ((await res.json()) as { error: { code: string } }).error.code;
const nothingWritten = () => {
  expect(fake.writes).toEqual([]);
  expect(fake.published).toEqual([]);
  expect(live.events).toEqual([]);
  expect(live.readings).toEqual([]);
};

describe("POST /api/spaces/:id/readings", () => {
  it("stores the value with its time as a manual reading and emits one reading", async () => {
    const res = await post("sess-carer-1", { value: 6.2, unit: "mmol" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ts: T0.toISOString(), mmol: 6.2, trend: "not-computable" });
    expect(live.readings).toHaveLength(1);
    expect(fake.source("s1", T0.toISOString())).toBe("manual");
    expect(live.spaces.find((s) => s.id === "s1")?.lastReadingAt).toEqual(T0);
    expect(fake.published.map((p) => [p.group, p.envelope.type])).toEqual([
      ["space-s1-glucose", "reading"],
    ]);
    expect(live.events.filter((e) => e.type === "reading")).toHaveLength(1);
    expect(tracked).toEqual([["reading.stored", { spaceId: "s1" }]]);
  });

  it("works for an owner and converts mg/dL to the stored mmol", async () => {
    const res = await post("sess-owner-1", { value: 112, unit: "mgdl" });
    expect(await res.json()).toMatchObject({ mmol: 6.2 });
  });

  it("refuses a time older than 24 hours or more than 5 minutes ahead", async () => {
    const old = await post("sess-carer-1", { value: 6, unit: "mmol", ts: minutesAgo(24 * 60 + 1) });
    expect([old.status, await error(old)]).toEqual([400, "reading-out-of-window"]);
    const ahead = await post("sess-carer-1", { value: 6, unit: "mmol", ts: minutesAgo(-6) });
    expect([ahead.status, await error(ahead)]).toEqual([400, "reading-out-of-window"]);
    nothingWritten();
    const edge = await post("sess-carer-1", { value: 6, unit: "mmol", ts: minutesAgo(-5) });
    expect(edge.status).toBe(200);
  });

  it("refuses a space whose source is a sensor", async () => {
    for (const id of ["sx", "sn"]) {
      const res = await post("sess-owner-1", { value: 6, unit: "mmol" }, id);
      expect([res.status, await error(res)]).toEqual([409, "source-not-manual"]);
    }
    nothingWritten();
  });

  it("answers a viewer 403, a non-member 404 and a simpleMode session 400 before any write", async () => {
    const body = { value: 6, unit: "mmol" };
    expect((await post("sess-viewer-1", body)).status).toBe(403);
    expect((await post("sess-other-1", body)).status).toBe(404);
    expect((await post(null, body)).status).toBe(403);
    const child = await post("sess-child-1", body);
    expect([child.status, await error(child)]).toEqual([400, "simple-mode"]);
    nothingWritten();
  });

  it("refuses a number that is no glucose value and writes nothing", async () => {
    for (const body of [
      { value: 45, unit: "mmol" },
      { value: 900, unit: "mgdl" },
      { value: 0, unit: "mmol" },
      { value: 6, unit: "mmol", extra: 1 },
      { value: "6", unit: "mmol" },
    ]) {
      const res = await post("sess-carer-1", body);
      expect([res.status, await error(res)]).toEqual([400, "validation"]);
    }
    nothingWritten();
  });

  it("replaces the value at the same time and emits again", async () => {
    const ts = minutesAgo(10);
    await post("sess-carer-1", { value: 6.2, unit: "mmol", ts });
    const res = await post("sess-carer-1", { value: 7.1, unit: "mmol", ts });
    expect(await res.json()).toEqual({ ts, mmol: 7.1, trend: "not-computable" });
    expect(live.readings).toHaveLength(1);
    expect(live.readings[0]?.mmol).toBe(7.1);
    expect(live.events.filter((e) => e.type === "reading")).toHaveLength(2);
  });

  it("never replaces a sensor reading and changes nothing", async () => {
    const ts = minutesAgo(10);
    fake.addSensorReading("s1", ts, 5.5);
    const res = await post("sess-carer-1", { value: 9, unit: "mmol", ts });
    expect([res.status, await error(res)]).toEqual([409, "reading-exists"]);
    expect(live.readings[0]?.mmol).toBe(5.5);
    expect(fake.writes).toEqual([]);
    expect(live.events).toEqual([]);
  });

  it("refuses when the owner switched to a sensor between the check and the write", async () => {
    fake.beforeGuard = () => {
      const space = live.spaces.find((s) => s.id === "s1");
      if (space) {
        space.glucoseSource = JSON.stringify({ type: "nightscout", secretRef: "g" });
      }
    };
    const res = await post("sess-carer-1", { value: 6, unit: "mmol" });
    expect([res.status, await error(res)]).toEqual([409, "source-not-manual"]);
    expect(live.readings).toEqual([]);
    expect(fake.published).toEqual([]);
    expect(tracked).toEqual([]);
  });

  it("moves lastReadingAt forward only", async () => {
    await post("sess-carer-1", { value: 6, unit: "mmol" });
    await post("sess-carer-1", { value: 6.5, unit: "mmol", ts: minutesAgo(120) });
    expect(live.spaces.find((s) => s.id === "s1")?.lastReadingAt).toEqual(T0);
  });

  it("rolls the row back when the event cannot be written", async () => {
    fake.failEvent = true;
    const res = await post("sess-carer-1", { value: 6, unit: "mmol" });
    expect(res.status).toBe(500);
    expect(live.readings).toEqual([]);
    expect(fake.published).toEqual([]);
    expect(tracked).toEqual([]);
  });

  it("keeps the manual reading out of a viewer's events and in a carer's", async () => {
    await post("sess-carer-1", { value: 6.2, unit: "mmol" });
    const page = async (session: string) =>
      (await (
        await eventsGet(liveRequest("s1", "events", session, { since: "0" }), spaceContext("s1"))
      ).json()) as EventsPage;
    expect((await page("sess-viewer-1")).events.filter((e) => e.type === "reading")).toEqual([]);
    expect((await page("sess-carer-1")).events.filter((e) => e.type === "reading")).toHaveLength(1);
  });

  it("logs ids, a code and the time, never the value", async () => {
    await post("sess-carer-1", { value: 6.37, unit: "mmol" });
    const lines = logs.all();
    expect(lines).not.toContain("6.3");
    expect(lines).not.toContain("6.4");
    for (const line of lines.split("\n")) {
      const keys = Object.keys(JSON.parse(line) as object);
      expect(
        keys.filter(
          (k) => !["level", "msg", "route", "spaceId", "userId", "code", "ms", "count"].includes(k),
        ),
      ).toEqual([]);
    }
    expect(lines).toContain('"userId":"carer-1"');
  });
});

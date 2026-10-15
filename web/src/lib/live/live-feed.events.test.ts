// @vitest-environment node
// The additive event surface of the feed (plan §7, task 8): `events` and `onEvent`, and the
// events-only feed a viewer's screen uses. The v0.1.0 protocol tests in live-feed.test.ts stand.
import type { EventEnvelope } from "@frejsi/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CURSOR_ONLY_SINCE, type EventsPage, type ReadingsWindow } from "./contracts";
import { LiveFeed, MAX_EVENTS, POLL_MS } from "./live-feed";
import { fakeFetch, fakeSocketFactory, jsonResponse, type FakeSocket } from "./test-support";

const T0 = new Date("2026-10-15T11:13:00.000Z");
const SOCKET_URL = "wss://example.webpubsub.azure.com/client/hubs/frejsi?access_token=example";

const mealCreated = (seq: number, mealId = `meal-${seq}`): EventEnvelope => ({
  spaceId: "s1",
  seq,
  ts: T0.toISOString(),
  type: "meal.created",
  payload: { mealId, ts: T0.toISOString(), totalCarbs: 14 },
});
const mealDeleted = (seq: number, mealId: string): EventEnvelope => ({
  spaceId: "s1",
  seq,
  ts: T0.toISOString(),
  type: "meal.deleted",
  payload: { mealId },
});
const readingEvent = (seq: number): EventEnvelope => ({
  spaceId: "s1",
  seq,
  ts: T0.toISOString(),
  type: "reading",
  payload: { ts: T0.toISOString(), mmol: 6.2, trend: "flat" },
});

const WINDOW: ReadingsWindow = {
  lastSeq: 10,
  sourceStatus: "connected",
  sourceSince: null,
  space: {
    glucoseUnit: "mmol",
    targetLow: 4,
    targetHigh: 10,
    timezone: "Europe/Copenhagen",
    sourceType: "dexcom-share",
  },
  readings: [],
  latest: null,
};

/** A server whose events log starts at `lastSeq`; `events?since=` clamps the cursor as the route does. */
function fakeServer(lastSeq: number) {
  const server = { lastSeq, events: [] as EventEnvelope[], live: true, eventsStatus: 200 };
  const { fetch, calls } = fakeFetch({
    "/readings": () => jsonResponse(WINDOW),
    "/negotiate": () =>
      server.live
        ? jsonResponse({ url: SOCKET_URL })
        : jsonResponse({ error: { code: "internal", message: "" } }, 503),
    "/events": (url) => {
      if (server.eventsStatus !== 200) {
        return jsonResponse({ error: { code: "not-found", message: "" } }, server.eventsStatus);
      }
      const since = Number(url.searchParams.get("since"));
      const upper = Math.max(server.lastSeq, server.events.at(-1)?.seq ?? 0);
      const events = server.events.filter((e) => e.seq > since);
      const page: EventsPage = { lastSeq: upper, events, more: false };
      return jsonResponse(page);
    },
  });
  return { server, fetch, calls };
}

const flush = () => vi.advanceTimersByTimeAsync(0);
let sockets: FakeSocket[];
let factory: ReturnType<typeof fakeSocketFactory>["factory"];

beforeEach(() => {
  vi.useFakeTimers({ now: T0 });
  ({ sockets, factory } = fakeSocketFactory());
});
afterEach(() => {
  vi.useRealTimers();
});

describe("LiveFeed events (plan §7, task 8)", () => {
  it("exposes the non-reading events it receives and hands each to its type's handlers", async () => {
    const { fetch } = fakeServer(10);
    const feed = new LiveFeed({ spaceId: "s1", fetch, socketFactory: factory });
    const created: string[] = [];
    const deleted: string[] = [];
    feed.onEvent("meal.created", (e) => created.push(e.payload.mealId));
    const off = feed.onEvent("meal.deleted", (e) => deleted.push(e.payload.mealId));
    feed.start();
    await flush();
    expect(feed.getState().events).toEqual([]);
    sockets[0]?.open();
    await flush();

    sockets[0]?.receive(readingEvent(11));
    sockets[0]?.receive(mealCreated(12, "m1"));
    sockets[0]?.receive(mealDeleted(13, "m1"));
    expect(feed.getState().events.map((e) => [e.seq, e.type])).toEqual([
      [12, "meal.created"],
      [13, "meal.deleted"],
    ]);
    expect(created).toEqual(["m1"]);
    expect(deleted).toEqual(["m1"]);
    // The reading still lands where Now reads it.
    expect(feed.getState().latest?.mmol).toBe(6.2);

    off();
    sockets[0]?.receive(mealDeleted(14, "m2"));
    expect(deleted).toEqual(["m1"]);
    feed.stop();
  });

  it("hands events that arrive through a catch-up to the handlers too", async () => {
    const { server, fetch } = fakeServer(10);
    server.events.push(mealCreated(11, "m-missed"));
    const feed = new LiveFeed({ spaceId: "s1", fetch, socketFactory: factory });
    const created: string[] = [];
    feed.onEvent("meal.created", (e) => created.push(e.payload.mealId));
    feed.start();
    await flush();
    sockets[0]?.open();
    await flush();
    expect(created).toEqual(["m-missed"]);
    feed.stop();
  });

  it("keeps a throwing handler from stopping the feed or the other handlers", async () => {
    const { fetch } = fakeServer(10);
    const feed = new LiveFeed({ spaceId: "s1", fetch, socketFactory: factory });
    const seen: number[] = [];
    feed.onEvent("meal.created", () => {
      throw new Error("screen bug");
    });
    feed.onEvent("meal.created", (e) => seen.push(e.seq));
    feed.start();
    await flush();
    sockets[0]?.open();
    await flush();
    sockets[0]?.receive(mealCreated(11));
    sockets[0]?.receive(mealCreated(12));
    expect(seen).toEqual([11, 12]);
    expect(feed.getState().lastSeq).toBe(12);
    feed.stop();
  });

  it(`keeps at most the last ${MAX_EVENTS} events`, async () => {
    const { fetch } = fakeServer(0);
    const feed = new LiveFeed({ spaceId: "s1", fetch, socketFactory: factory, readings: false });
    feed.start();
    await flush();
    sockets[0]?.open();
    await flush();
    for (let seq = 1; seq <= MAX_EVENTS + 5; seq += 1) sockets[0]?.receive(mealCreated(seq));
    const events = feed.getState().events;
    expect(events).toHaveLength(MAX_EVENTS);
    expect(events[0]?.seq).toBe(6);
    expect(events.at(-1)?.seq).toBe(MAX_EVENTS + 5);
    feed.stop();
  });
});

describe("LiveFeed without readings (the viewer's day)", () => {
  it("never asks for readings: it takes the cursor from events, negotiates and connects", async () => {
    const { fetch, calls } = fakeServer(42);
    const feed = new LiveFeed({ spaceId: "s1", fetch, socketFactory: factory, readings: false });
    feed.start();
    expect(feed.getState().loaded).toBe(false);
    await flush();
    expect(feed.getState()).toMatchObject({
      loaded: true,
      lastSeq: 42,
      readings: [],
      latest: null,
    });
    sockets[0]?.open();
    await flush();
    expect(feed.getState().connection).toBe("live");
    expect(calls).toEqual([
      `/api/spaces/s1/events?since=${CURSOR_ONLY_SINCE}`,
      "/api/spaces/s1/negotiate",
      "/api/spaces/s1/events?since=42",
    ]);
    expect(calls.some((c) => c.includes("readings"))).toBe(false);

    const created: string[] = [];
    feed.onEvent("meal.created", (e) => created.push(e.payload.mealId));
    sockets[0]?.receive(mealCreated(43, "m1"));
    expect(created).toEqual(["m1"]);
    expect(feed.getState().lastSeq).toBe(43);
    feed.stop();
  });

  it("does not reload anything on space or member events, and still hands them on", async () => {
    const { fetch, calls } = fakeServer(5);
    const feed = new LiveFeed({ spaceId: "s1", fetch, socketFactory: factory, readings: false });
    feed.start();
    await flush();
    sockets[0]?.open();
    await flush();
    const before = calls.length;
    sockets[0]?.receive({
      spaceId: "s1",
      seq: 6,
      ts: T0.toISOString(),
      type: "space.updated",
      payload: { fields: ["timezone"] },
    });
    await flush();
    expect(calls.length).toBe(before);
    expect(feed.getState().events.map((e) => e.type)).toEqual(["space.updated"]);
    feed.stop();
  });

  it("asks the server again on a member removal, and stops when it is this member", async () => {
    const { server, fetch } = fakeServer(5);
    const feed = new LiveFeed({ spaceId: "s1", fetch, socketFactory: factory, readings: false });
    feed.start();
    await flush();
    sockets[0]?.open();
    await flush();
    sockets[0]?.receive(mealCreated(6));
    await flush();
    // The owner removes this member: the server refuses from now on, the socket is not closed.
    server.eventsStatus = 404;
    sockets[0]?.receive({
      spaceId: "s1",
      seq: 7,
      ts: T0.toISOString(),
      type: "member.removed",
      payload: { userId: "u-viewer" },
    });
    await flush();
    expect(feed.getState()).toMatchObject({ loaded: false, error: "not-found" });
    feed.stop();
  });

  it("polls events every 30 s when negotiate is unavailable, and hands on what it finds", async () => {
    const { server, fetch, calls } = fakeServer(7);
    server.live = false;
    const feed = new LiveFeed({ spaceId: "s1", fetch, socketFactory: factory, readings: false });
    const created: string[] = [];
    feed.onEvent("meal.created", (e) => created.push(e.payload.mealId));
    feed.start();
    await flush();
    expect(feed.getState().connection).toBe("polling");
    server.events.push(mealCreated(8, "m-polled"));
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(created).toEqual(["m-polled"]);
    expect(calls.some((c) => c.includes("readings"))).toBe(false);
    feed.stop();
  });

  it("retries the cursor on the timer when the first request fails, and stops on a refusal", async () => {
    const { server, fetch } = fakeServer(3);
    server.eventsStatus = 500;
    const feed = new LiveFeed({ spaceId: "s1", fetch, socketFactory: factory, readings: false });
    feed.start();
    await flush();
    expect(feed.getState().loaded).toBe(false);
    server.eventsStatus = 200;
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(feed.getState()).toMatchObject({ loaded: true, lastSeq: 3 });
    feed.stop();

    const refused = fakeServer(3);
    refused.server.eventsStatus = 404;
    const gone = new LiveFeed({
      spaceId: "s1",
      fetch: refused.fetch,
      socketFactory: factory,
      readings: false,
    });
    gone.start();
    await flush();
    expect(gone.getState()).toMatchObject({ loaded: false, error: "not-found" });
  });
});

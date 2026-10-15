// @vitest-environment node
import type { EventEnvelope, Reading } from "@frejsi/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EventsPage, ReadingsWindow } from "./contracts";
import { LiveFeed, POLL_MS } from "./live-feed";
import { fakeFetch, fakeSocketFactory, jsonResponse, type FakeSocket } from "./test-support";

const T0 = new Date("2026-10-15T13:13:00.000Z");
const minutesAgo = (m: number) => new Date(T0.getTime() - m * 60_000).toISOString();
const SOCKET_URL = "wss://example.webpubsub.azure.com/client/hubs/frejsi?access_token=example";

const reading = (ts: string, mmol: number, trend: Reading["trend"] = "flat"): Reading => ({
  ts,
  mmol,
  trend,
});

const envelope = (seq: number, payload: Reading): EventEnvelope => ({
  spaceId: "s1",
  seq,
  ts: payload.ts,
  type: "reading",
  payload,
});

/** A server with a readings window, an events log and a negotiate that can be turned off. */
function fakeServer(initial: { readings: Reading[]; lastSeq: number }) {
  const server = {
    live: true,
    /** When true, negotiate never answers (a stalled credential call on the server). */
    negotiateHangs: false,
    events: [] as EventEnvelope[],
    window: {
      lastSeq: initial.lastSeq,
      sourceStatus: "connected",
      sourceSince: minutesAgo(60),
      space: {
        glucoseUnit: "mmol",
        targetLow: 4,
        targetHigh: 10,
        timezone: "Europe/Copenhagen",
        sourceType: "dexcom-share",
      },
      readings: initial.readings,
    } satisfies ReadingsWindow as ReadingsWindow,
    readingsStatus: 200,
    /** Delivery delay in ms for the next pages/windows; the content is fixed when the request is made. */
    delayMs: 0,
    append(payload: Reading): EventEnvelope {
      const seq = (server.events.at(-1)?.seq ?? server.window.lastSeq) + 1;
      const env = envelope(seq, payload);
      server.events.push(env);
      return env;
    },
  };
  const delayed = (response: Response): Response | Promise<Response> =>
    server.delayMs > 0
      ? new Promise((resolve) => {
          setTimeout(() => {
            resolve(response);
          }, server.delayMs);
        })
      : response;
  const { fetch, calls } = fakeFetch({
    "/readings": () =>
      delayed(
        server.readingsStatus === 200
          ? jsonResponse(server.window)
          : jsonResponse({ error: { code: "forbidden", message: "" } }, server.readingsStatus),
      ),
    "/negotiate": () =>
      server.negotiateHangs
        ? new Promise<Response>(() => undefined)
        : server.live
        ? jsonResponse({ url: SOCKET_URL })
        : jsonResponse({ error: { code: "internal", message: "" } }, 503),
    "/events": (url) => {
      const since = Number(url.searchParams.get("since"));
      const events = server.events.filter((e) => e.seq > since);
      const page: EventsPage = {
        lastSeq: events.at(-1)?.seq ?? Math.max(since, server.window.lastSeq),
        events,
        more: false,
      };
      return delayed(jsonResponse(page));
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

function start(fetch: typeof globalThis.fetch, hours = 24) {
  const feed = new LiveFeed({ spaceId: "s1", hours, fetch, socketFactory: factory });
  const states: string[] = [];
  feed.subscribe(() => states.push(feed.getState().connection));
  feed.start();
  return { feed, states };
}

describe("LiveFeed (plan §5)", () => {
  it("loads the window, negotiates, connects, and fetches events?since=lastSeq on connect", async () => {
    const { server, fetch, calls } = fakeServer({
      readings: [reading(minutesAgo(8), 6.0), reading(minutesAgo(3), 6.2, "forty-five-up")],
      lastSeq: 12,
    });
    server.append(reading(minutesAgo(1), 6.3));
    const { feed } = start(fetch, 3);
    await flush();
    expect(calls[0]).toBe("/api/spaces/s1/readings?hours=3");
    expect(calls[1]).toBe("/api/spaces/s1/negotiate");
    expect(sockets).toHaveLength(1);
    expect(sockets[0]?.url).toBe(SOCKET_URL);
    expect(feed.getState().connection).toBe("connecting");

    sockets[0]?.open();
    await flush();
    expect(feed.getState().connection).toBe("live");
    expect(calls[2]).toBe("/api/spaces/s1/events?since=12");
    expect(feed.getState().lastSeq).toBe(13);
    expect(feed.getState().readings.map((r) => r.mmol)).toEqual([6.0, 6.2, 6.3]);
    expect(feed.getState().space?.targetHigh).toBe(10);
    expect(feed.getState().sourceStatus).toBe("connected");
    expect(calls).toHaveLength(3);
  });

  it("applies a pushed reading in order and refetches on a gap", async () => {
    const { server, fetch, calls } = fakeServer({ readings: [], lastSeq: 5 });
    const { feed } = start(fetch);
    await flush();
    sockets[0]?.open();
    await flush();
    expect(feed.getState().lastSeq).toBe(5);

    const six = server.append(reading(minutesAgo(5), 5.9));
    sockets[0]?.receive(six);
    expect(feed.getState().lastSeq).toBe(6);
    expect(feed.getState().readings.map((r) => r.mmol)).toEqual([5.9]);

    // Seq 7 is missed (iOS slept); seq 8 arrives: the feed fetches from 6 and ends up with both.
    server.append(reading(minutesAgo(3), 6.1));
    const eight = server.append(reading(minutesAgo(1), 6.4));
    const before = calls.length;
    sockets[0]?.receive(eight);
    await flush();
    expect(calls.slice(before)).toEqual(["/api/spaces/s1/events?since=6"]);
    expect(feed.getState().lastSeq).toBe(8);
    expect(feed.getState().readings.map((r) => r.mmol)).toEqual([5.9, 6.1, 6.4]);

    // An old or duplicate message changes nothing.
    sockets[0]?.receive(six);
    sockets[0]?.receive("not json");
    expect(feed.getState().readings).toHaveLength(3);
  });

  it("polls every 30 s while the socket is down, re-negotiates and catches up on reconnect, then stops polling", async () => {
    const { server, fetch, calls } = fakeServer({ readings: [], lastSeq: 1 });
    const { feed } = start(fetch);
    await flush();
    sockets[0]?.open();
    await flush();
    calls.length = 0;

    server.append(reading(minutesAgo(2), 7.0));
    sockets[0]?.drop();
    await flush();
    expect(feed.getState().connection).toBe("polling");
    // Catch-up right away, so the screen is fresh while the socket is gone.
    expect(calls).toEqual(["/api/spaces/s1/events?since=1"]);
    expect(feed.getState().readings.map((r) => r.mmol)).toEqual([7.0]);

    server.live = false;
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(calls.slice(1)).toEqual(["/api/spaces/s1/events?since=2", "/api/spaces/s1/negotiate"]);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(calls.slice(3)).toEqual(["/api/spaces/s1/events?since=2", "/api/spaces/s1/negotiate"]);
    expect(sockets).toHaveLength(1);

    // The transport is back: the tick's catch-up, a new token, a new socket, one catch-up on open,
    // and no more polling.
    server.live = true;
    server.append(reading(minutesAgo(1), 7.2));
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(calls.slice(5)).toEqual(["/api/spaces/s1/events?since=2", "/api/spaces/s1/negotiate"]);
    expect(sockets).toHaveLength(2);
    sockets[1]?.open();
    await flush();
    expect(calls.slice(7)).toEqual(["/api/spaces/s1/events?since=3"]);
    expect(feed.getState().connection).toBe("live");
    expect(feed.getState().readings.map((r) => r.mmol)).toEqual([7.0, 7.2]);
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(calls).toHaveLength(8);
  });

  it("falls back to polling when negotiate answers 503 (no Web PubSub), without a socket", async () => {
    const { server, fetch, calls } = fakeServer({ readings: [], lastSeq: 0 });
    server.live = false;
    const { feed } = start(fetch);
    await flush();
    expect(sockets).toHaveLength(0);
    expect(feed.getState().connection).toBe("polling");
    expect(feed.getState().loaded).toBe(true);
    // The window is current: no catch-up until the first tick.
    expect(calls).toEqual(["/api/spaces/s1/readings?hours=24", "/api/spaces/s1/negotiate"]);
    server.append(reading(minutesAgo(1), 8.0));
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(calls.slice(2)).toEqual(["/api/spaces/s1/events?since=0", "/api/spaces/s1/negotiate"]);
    expect(feed.getState().readings.map((r) => r.mmol)).toEqual([8.0]);
    expect(feed.getState().lastSeq).toBe(1);
  });

  it("keeps polling while a socket handshake never finishes, and replaces that socket on the next tick", async () => {
    const { server, fetch, calls } = fakeServer({ readings: [], lastSeq: 1 });
    const { feed } = start(fetch);
    await flush();
    expect(sockets).toHaveLength(1);
    expect(feed.getState().connection).toBe("connecting");
    calls.length = 0;

    // A network that lets HTTPS through but stalls WebSockets: the screen is still fed over HTTP.
    server.append(reading(minutesAgo(1), 6.6));
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(calls).toEqual(["/api/spaces/s1/events?since=1", "/api/spaces/s1/negotiate"]);
    expect(feed.getState().readings.map((r) => r.mmol)).toEqual([6.6]);
    expect(sockets[0]?.closed).toBe(true);
    expect(sockets).toHaveLength(2);

    sockets[1]?.open();
    await flush();
    expect(feed.getState().connection).toBe("live");
    const before = calls.length;
    await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    expect(calls).toHaveLength(before);
  });

  it("polls while negotiate never answers, and tries negotiate again on the next tick", async () => {
    const { server, fetch, calls } = fakeServer({ readings: [], lastSeq: 1 });
    server.negotiateHangs = true;
    const { feed } = start(fetch);
    await flush();
    expect(sockets).toHaveLength(0);
    calls.length = 0;

    server.append(reading(minutesAgo(1), 7.1));
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(feed.getState().connection).toBe("polling");
    expect(calls).toEqual(["/api/spaces/s1/events?since=1", "/api/spaces/s1/negotiate"]);
    expect(feed.getState().readings.map((r) => r.mmol)).toEqual([7.1]);

    server.negotiateHangs = false;
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(sockets).toHaveLength(1);
    sockets[0]?.open();
    await flush();
    expect(feed.getState().connection).toBe("live");
  });

  it("opens one socket when start–stop–start races the first window (React strict mode)", async () => {
    const { fetch, calls } = fakeServer({ readings: [], lastSeq: 1 });
    const feed = new LiveFeed({ spaceId: "s1", fetch, socketFactory: factory });
    feed.start();
    feed.stop();
    feed.start();
    await flush();
    expect(calls.filter((c) => c.includes("/negotiate"))).toHaveLength(1);
    expect(sockets).toHaveLength(1);
    feed.stop();
    expect(sockets[0]?.closed).toBe(true);
  });

  it("does not let a catch-up page that answers late restore a status messages have moved past", async () => {
    const { server, fetch } = fakeServer({ readings: [], lastSeq: 10 });
    const { feed } = start(fetch);
    await flush();
    sockets[0]?.open();
    await flush();

    const status = (seq: number, value: "connected" | "disconnected"): EventEnvelope => ({
      spaceId: "s1",
      seq,
      ts: T0.toISOString(),
      type: "source.status",
      payload: { status: value, since: T0.toISOString() },
    });
    server.events.push(status(11, "disconnected"));
    server.delayMs = 100;
    // A gap message starts a catch-up whose page (seq 11 only) is slow to arrive.
    sockets[0]?.receive(status(13, "connected"));
    // Meanwhile the socket delivers 11 and 12 in order.
    sockets[0]?.receive(status(11, "disconnected"));
    sockets[0]?.receive(status(12, "connected"));
    expect(feed.getState().sourceStatus).toBe("connected");
    expect(feed.getState().lastSeq).toBe(12);

    await vi.advanceTimersByTimeAsync(100);
    expect(feed.getState().sourceStatus).toBe("connected");
    expect(feed.getState().lastSeq).toBe(12);
  });

  it("keeps a reading that arrived while the window was reloading after space.updated", async () => {
    const { server, fetch, calls } = fakeServer({ readings: [], lastSeq: 1 });
    const { feed } = start(fetch);
    await flush();
    sockets[0]?.open();
    await flush();

    // The reload's window is captured at seq 2, but seq 3 reaches the socket before it arrives.
    server.window = { ...server.window, lastSeq: 2 };
    server.delayMs = 100;
    sockets[0]?.receive({
      spaceId: "s1",
      seq: 2,
      ts: T0.toISOString(),
      type: "space.updated",
      payload: { fields: ["targetHigh"] },
    });
    const three = server.append(reading(minutesAgo(1), 9.1));
    sockets[0]?.receive(three);
    expect(feed.getState().lastSeq).toBe(3);

    server.delayMs = 0;
    await vi.advanceTimersByTimeAsync(100);
    await flush();
    expect(calls.at(-1)).toBe("/api/spaces/s1/events?since=2");
    expect(feed.getState().lastSeq).toBe(3);
    expect(feed.getState().readings.map((r) => r.mmol)).toEqual([9.1]);
  });

  it("stops everything on stop(): the socket closes and no timer fires", async () => {
    const { server, fetch, calls } = fakeServer({ readings: [], lastSeq: 0 });
    server.live = false;
    const { feed } = start(fetch);
    await flush();
    feed.stop();
    const before = calls.length;
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(calls).toHaveLength(before);

    server.live = true;
    const second = new LiveFeed({ spaceId: "s1", fetch, socketFactory: factory });
    second.start();
    await flush();
    sockets[0]?.open();
    second.stop();
    expect(sockets[0]?.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(second.getState().connection).toBe("polling");
  });

  it("applies source.status and reloads the window on space.updated; keeps only the window's hours", async () => {
    const { server, fetch, calls } = fakeServer({
      readings: [reading(minutesAgo(170), 5.0), reading(minutesAgo(10), 6.0)],
      lastSeq: 1,
    });
    const { feed } = start(fetch, 3);
    await flush();
    sockets[0]?.open();
    await flush();

    sockets[0]?.receive({
      spaceId: "s1",
      seq: 2,
      ts: T0.toISOString(),
      type: "source.status",
      payload: { status: "disconnected", since: T0.toISOString() },
    });
    expect(feed.getState().sourceStatus).toBe("disconnected");
    expect(feed.getState().sourceSince).toBe(T0.toISOString());

    // Twenty minutes later a reading arrives: the 170-minute-old one has left the 3-hour window.
    vi.setSystemTime(new Date(T0.getTime() + 20 * 60_000));
    server.window.lastSeq = 2;
    sockets[0]?.receive(
      envelope(3, reading(new Date(T0.getTime() + 19 * 60_000).toISOString(), 6.5)),
    );
    expect(feed.getState().readings.map((r) => r.mmol)).toEqual([6.0, 6.5]);

    server.window = {
      ...server.window,
      lastSeq: 4,
      space: { ...server.window.space, targetHigh: 9 },
    };
    const before = calls.length;
    sockets[0]?.receive({
      spaceId: "s1",
      seq: 4,
      ts: T0.toISOString(),
      type: "space.updated",
      payload: { fields: ["targetHigh"] },
    });
    await flush();
    expect(calls.slice(before)).toEqual(["/api/spaces/s1/readings?hours=3"]);
    expect(feed.getState().space?.targetHigh).toBe(9);
    expect(feed.getState().lastSeq).toBe(4);
  });

  it("stops and reports forbidden when the readings window is refused (a viewer by URL)", async () => {
    const { server, fetch, calls } = fakeServer({ readings: [], lastSeq: 0 });
    server.readingsStatus = 403;
    const { feed } = start(fetch);
    await flush();
    expect(feed.getState().error).toBe("forbidden");
    expect(feed.getState().loaded).toBe(false);
    expect(calls).toEqual(["/api/spaces/s1/readings?hours=24"]);
    await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    expect(calls).toHaveLength(1);
  });

  it("retries a failed settings reload on the timer, without touching a live socket", async () => {
    const { server, fetch, calls } = fakeServer({ readings: [], lastSeq: 1 });
    const { feed } = start(fetch);
    await flush();
    sockets[0]?.open();
    await flush();

    server.readingsStatus = 500;
    sockets[0]?.receive({
      spaceId: "s1",
      seq: 2,
      ts: T0.toISOString(),
      type: "space.updated",
      payload: { fields: ["glucoseUnit"] },
    });
    await flush();
    expect(feed.getState().connection).toBe("live");
    expect(feed.getState().space?.glucoseUnit).toBe("mmol");

    server.readingsStatus = 200;
    server.window = {
      ...server.window,
      lastSeq: 2,
      space: { ...server.window.space, glucoseUnit: "mgdl" },
    };
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(feed.getState().space?.glucoseUnit).toBe("mgdl");
    expect(feed.getState().connection).toBe("live");
    expect(sockets).toHaveLength(1);
    expect(sockets[0]?.closed).toBe(false);
    const before = calls.length;
    await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    expect(calls).toHaveLength(before);
  });

  it("keeps retrying a failed settings reload when the socket opens after the failure", async () => {
    const { server, fetch, calls } = fakeServer({ readings: [], lastSeq: 1 });
    const { feed } = start(fetch);
    await flush();
    sockets[0]?.open();
    await flush();
    sockets[0]?.drop();
    await flush();
    expect(feed.getState().connection).toBe("polling");

    // The tick's catch-up brings a space.updated whose reload fails; the same tick's negotiate
    // succeeds and the new socket opens after that failure.
    server.events.push({
      spaceId: "s1",
      seq: 2,
      ts: T0.toISOString(),
      type: "space.updated",
      payload: { fields: ["glucoseUnit"] },
    });
    server.readingsStatus = 500;
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(sockets).toHaveLength(2);
    sockets[1]?.open();
    await flush();
    expect(feed.getState().connection).toBe("live");
    expect(feed.getState().space?.glucoseUnit).toBe("mmol");

    server.readingsStatus = 200;
    server.window = {
      ...server.window,
      lastSeq: 2,
      space: { ...server.window.space, glucoseUnit: "mgdl" },
    };
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(feed.getState().space?.glucoseUnit).toBe("mgdl");
    expect(feed.getState().connection).toBe("live");
    expect(sockets[1]?.closed).toBe(false);
    const before = calls.length;
    await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    expect(calls).toHaveLength(before);
  });

  it("retries the first window when its body is broken, instead of loading forever", async () => {
    const { server, fetch, calls } = fakeServer({
      readings: [reading(minutesAgo(1), 6.0)],
      lastSeq: 3,
    });
    const { fetch: brokenFetch } = fakeFetch({
      "/readings": () =>
        new Response("{not json", { status: 200, headers: { "content-type": "application/json" } }),
    });
    let broken = true;
    const switching: typeof globalThis.fetch = (input, init) =>
      broken ? brokenFetch(input, init) : fetch(input, init);
    const { feed } = start(switching);
    await flush();
    expect(feed.getState().loaded).toBe(false);
    expect(feed.getState().connection).toBe("polling");
    broken = false;
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(feed.getState().loaded).toBe(true);
    expect(feed.getState().readings).toHaveLength(1);
    expect(server.readingsStatus).toBe(200);
    expect(calls.filter((c) => c.includes("/readings"))).toHaveLength(1);
  });

  it("retries the window on the poll timer after a server fault", async () => {
    const { server, fetch, calls } = fakeServer({
      readings: [reading(minutesAgo(1), 6.0)],
      lastSeq: 3,
    });
    server.readingsStatus = 500;
    const { feed } = start(fetch);
    await flush();
    expect(feed.getState().loaded).toBe(false);
    expect(feed.getState().error).toBeNull();
    expect(feed.getState().connection).toBe("polling");
    server.readingsStatus = 200;
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(feed.getState().loaded).toBe(true);
    expect(feed.getState().readings).toHaveLength(1);
    expect(calls.filter((c) => c.includes("/readings"))).toHaveLength(2);
  });
});

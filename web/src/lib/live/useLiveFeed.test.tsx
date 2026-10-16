import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeFetch, fakeSocketFactory, jsonResponse } from "./test-support";
import { useLiveFeed } from "./useLiveFeed";

const T0 = new Date("2026-10-15T13:13:00.000Z");

beforeEach(() => {
  vi.useFakeTimers({ now: T0 });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useLiveFeed", () => {
  it("starts the feed on mount, renders its state, and stops it on unmount", async () => {
    const { factory, sockets } = fakeSocketFactory();
    const { fetch, calls } = fakeFetch({
      "/readings": () =>
        jsonResponse({
          lastSeq: 3,
          sourceStatus: "connected",
          sourceSince: null,
          space: {
            glucoseUnit: "mmol",
            targetLow: 4,
            targetHigh: 10,
            timezone: "Europe/Copenhagen",
            sourceType: "dexcom-share",
          },
          readings: [{ ts: "2026-10-15T13:10:00.000Z", mmol: 6.2, trend: "forty-five-up" }],
          latest: { ts: "2026-10-15T13:10:00.000Z", mmol: 6.2, trend: "forty-five-up" },
        }),
      "/negotiate": () => jsonResponse({ url: "wss://example/hub" }),
      "/events": () => jsonResponse({ lastSeq: 3, events: [], more: false }),
    });
    const { result, unmount } = renderHook(() =>
      useLiveFeed("s1", { hours: 3, fetch, socketFactory: factory }),
    );
    expect(result.current.loaded).toBe(false);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(result.current.loaded).toBe(true);
    expect(result.current.readings).toEqual([
      { ts: "2026-10-15T13:10:00.000Z", mmol: 6.2, trend: "forty-five-up" },
    ]);
    act(() => sockets[0]?.open());
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(result.current.connection).toBe("live");
    expect(calls).toEqual([
      "/api/spaces/s1/readings?hours=3",
      "/api/spaces/s1/negotiate",
      "/api/spaces/s1/events?since=3",
    ]);
    unmount();
    expect(sockets[0]?.closed).toBe(true);
  });

  it("catches up when the page comes back to the foreground, and stops listening on unmount", async () => {
    const { factory, sockets } = fakeSocketFactory();
    const { fetch, calls } = fakeFetch({
      "/readings": () =>
        jsonResponse({
          lastSeq: 3,
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
        }),
      "/negotiate": () => jsonResponse({ url: "wss://example/hub" }),
      "/events": () => jsonResponse({ lastSeq: 3, events: [], more: false }),
    });
    let visibility: DocumentVisibilityState = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
    const { unmount } = renderHook(() => useLiveFeed("s1", { fetch, socketFactory: factory }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    act(() => sockets[0]?.open());
    await act(() => vi.advanceTimersByTimeAsync(0));
    calls.length = 0;

    // Going to the background changes nothing; coming back to a long-silent socket replaces it.
    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    await act(() => vi.advanceTimersByTimeAsync(5 * 60_000));
    expect(calls).toEqual([]);
    visibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(calls).toEqual(["/api/spaces/s1/events?since=3", "/api/spaces/s1/negotiate"]);
    expect(sockets[0]?.closed).toBe(true);
    expect(sockets).toHaveLength(2);

    // The network coming back counts too, once the burst window has passed.
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    calls.length = 0;
    window.dispatchEvent(new Event("online"));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(calls[0]).toBe("/api/spaces/s1/events?since=3");

    unmount();
    calls.length = 0;
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("online"));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(calls).toEqual([]);
  });
});

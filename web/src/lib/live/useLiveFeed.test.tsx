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
});

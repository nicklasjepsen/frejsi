import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeFetch, fakeSocketFactory, jsonResponse } from "./test-support";
import { useLiveFeed } from "./useLiveFeed";

const T0 = new Date("2026-10-15T11:13:00.000Z");

beforeEach(() => {
  vi.useFakeTimers({ now: T0 });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useLiveFeed events (plan §7, task 8)", () => {
  it("exposes events and subscribe; without readings it never asks for readings", async () => {
    const { factory, sockets } = fakeSocketFactory();
    const { fetch, calls } = fakeFetch({
      "/negotiate": () => jsonResponse({ url: "wss://example/hub" }),
      "/events": () => jsonResponse({ lastSeq: 4, events: [], more: false }),
    });
    const { result } = renderHook(() =>
      useLiveFeed("s1", { fetch, socketFactory: factory, readings: false }),
    );
    expect(result.current.events).toEqual([]);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(result.current.loaded).toBe(true);
    act(() => sockets[0]?.open());
    await act(() => vi.advanceTimersByTimeAsync(0));

    const updated: string[] = [];
    const off = result.current.subscribe("meal.updated", (e) => updated.push(e.payload.mealId));
    act(() =>
      sockets[0]?.receive({
        spaceId: "s1",
        seq: 5,
        ts: T0.toISOString(),
        type: "meal.updated",
        payload: { mealId: "m1" },
      }),
    );
    expect(updated).toEqual(["m1"]);
    expect(result.current.events.map((e) => e.type)).toEqual(["meal.updated"]);
    off();
    expect(calls.some((c) => c.includes("/readings"))).toBe(false);
  });
});

import "@testing-library/jest-dom/vitest";

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeApi, meal, type FakeApi } from "@/components/simple/test-support";

import { DAY_RECHECK_MS, useDay } from "./useDay";

const handlers = new Map<string, Set<() => void>>();
const subscribe = (type: string, handler: () => void) => {
  const set = handlers.get(type) ?? new Set();
  set.add(handler);
  handlers.set(type, set);
  return () => {
    set.delete(handler);
  };
};
const emit = (type: string) => {
  for (const handler of handlers.get(type) ?? []) handler();
};

function Probe({ loaded, spaceId = "s1" }: { loaded: boolean; spaceId?: string }) {
  const state = useDay(spaceId, subscribe, loaded);
  return (
    <p data-testid="probe">
      {state.status === "ready" ? `${state.day.date}:${state.day.mealCount}` : state.status}
    </p>
  );
}

let api: FakeApi;
const dayReads = () => api.calls.filter((call) => call.path === "day").length;
const settle = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });

beforeEach(() => {
  // 23:59:50 on 15 October in Copenhagen.
  vi.useFakeTimers({ now: new Date("2026-10-15T21:59:50.000Z") });
  handlers.clear();
  api = fakeApi({ meals: [meal("m1", "2026-10-15T10:10:00.000Z", "Lunch", 50)] });
  vi.stubGlobal("fetch", api.fetch);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("useDay (Nu's meal regions)", () => {
  it("reads the day, and again once the feed has its cursor", async () => {
    const { rerender } = render(<Probe loaded={false} />);
    await settle();
    expect(screen.getByTestId("probe")).toHaveTextContent("2026-10-15:1");
    expect(dayReads()).toBe(1);
    rerender(<Probe loaded />);
    await settle();
    expect(dayReads()).toBe(2);
  });

  it("reads again on every meal event and on focus", async () => {
    render(<Probe loaded />);
    await settle();
    api.meals = [];
    act(() => {
      emit("meal.deleted");
    });
    await settle();
    expect(screen.getByTestId("probe")).toHaveTextContent("2026-10-15:0");
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await settle();
    expect(dayReads()).toBe(3);
  });

  it("reads the new day when the space's day turns at midnight", async () => {
    render(<Probe loaded />);
    await settle();
    api.date = "2026-10-16";
    api.meals = [];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DAY_RECHECK_MS);
    });
    expect(screen.getByTestId("probe")).toHaveTextContent("2026-10-16:0");
    const reads = dayReads();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DAY_RECHECK_MS);
    });
    expect(dayReads()).toBe(reads);
  });

  it("keeps the day on screen when a refresh fails, and retries a failed first read", async () => {
    api.failing.add("GET day");
    render(<Probe loaded />);
    await settle();
    expect(screen.getByTestId("probe")).toHaveTextContent("failed");
    api.failing.clear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DAY_RECHECK_MS);
    });
    expect(screen.getByTestId("probe")).toHaveTextContent("2026-10-15:1");
    api.failing.add("GET day");
    act(() => {
      emit("meal.created");
    });
    await settle();
    expect(screen.getByTestId("probe")).toHaveTextContent("2026-10-15:1");
    // That failed refresh is retried by the recheck, not left until the next event.
    api.failing.clear();
    api.meals = [];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DAY_RECHECK_MS);
    });
    expect(screen.getByTestId("probe")).toHaveTextContent("2026-10-15:0");
  });

  it("never shows one space's day under another: a failed read after a switch shows the failure", async () => {
    const { rerender } = render(<Probe loaded />);
    await settle();
    expect(screen.getByTestId("probe")).toHaveTextContent("2026-10-15:1");
    api.failing.add("GET day");
    rerender(<Probe loaded spaceId="s2" />);
    expect(screen.getByTestId("probe")).toHaveTextContent("loading");
    await settle();
    expect(screen.getByTestId("probe")).toHaveTextContent("failed");
  });
});

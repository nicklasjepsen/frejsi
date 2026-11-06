import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LOAD_TIMING_PATH, loadTimingQuery } from "@/lib/diag/load-timing";

import { LoadTiming } from "./LoadTiming";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const timings = {
  type: "navigate",
  workerStart: 12.4,
  fetchStart: 15,
  domainLookupStart: 20,
  domainLookupEnd: 95.6,
  connectStart: 96,
  connectEnd: 180,
  requestStart: 181,
  responseStart: 61_000.2,
  responseEnd: 61_050,
  domInteractive: 61_400,
  loadEventEnd: 62_000,
  domContentLoadedEventEnd: 61_500,
  redirectCount: 2,
};
const entry = timings as unknown as PerformanceNavigationTiming;

describe("loadTimingQuery", () => {
  it("turns the navigation entry into whole milliseconds, steps as durations", () => {
    const query = new URLSearchParams(loadTimingQuery(entry, { v: "v0.7.5", os: "ios", pwa: 1 }));
    expect(Object.fromEntries(query)).toEqual({
      v: "v0.7.5",
      os: "ios",
      pwa: "1",
      type: "navigate",
      worker: "12",
      fetch: "15",
      dns: "76",
      connect: "84",
      request: "181",
      firstByte: "61000",
      response: "61050",
      interactive: "61400",
      loaded: "62000",
      redirects: "2",
    });
  });

  it("leaves out the steps the browser did not take, and sends only the facts without an entry", () => {
    const cached = {
      ...timings,
      workerStart: 0,
      domainLookupStart: 0,
      connectStart: 0,
      loadEventEnd: 0,
    } as unknown as PerformanceNavigationTiming;
    const query = new URLSearchParams(loadTimingQuery(cached, {}));
    expect(query.has("worker")).toBe(false);
    expect(query.has("dns")).toBe(false);
    expect(query.has("connect")).toBe(false);
    expect(query.get("loaded")).toBe("61500");
    expect(loadTimingQuery(undefined, { type: "restore", slept: 3600 })).toBe(
      "type=restore&slept=3600",
    );
  });
});

describe("LoadTiming", () => {
  it("reports once in production, with numbers and fixed words only", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_VERSION", "v0.7.5");
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([entry]);
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    render(<LoadTiming />);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url.startsWith(`${LOAD_TIMING_PATH}/`)).toBe(true);
    const query = new URLSearchParams(
      url
        .slice(LOAD_TIMING_PATH.length + 1)
        .replaceAll(",", "&")
        .replaceAll(":", "="),
    );
    expect(query.get("v")).toBe("v0.7.5");
    expect(query.get("firstByte")).toBe("61000");
    for (const value of query.values()) expect(value).toMatch(/^(\d+|[a-z_]+|v[\w.-]+)$/);
  });

  it("sends nothing outside production", () => {
    vi.stubEnv("NODE_ENV", "test");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<LoadTiming />);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

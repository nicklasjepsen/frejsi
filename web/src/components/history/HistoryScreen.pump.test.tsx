import "@testing-library/jest-dom/vitest";

import type { DayHistoryView } from "@frejsi/shared/schemas/history";
import type { PumpBolusView } from "@frejsi/shared/schemas/pump";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSocketFactory } from "@/lib/live/test-support";

import da from "../../../messages/da";
import { HistoryScreen } from "./HistoryScreen";
import { ViewerDays } from "./ViewerDays";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const NOW = new Date("2026-10-14T11:20:00.000Z"); // 13:20 in Copenhagen
const TODAY = "2026-10-14";
const range = {
  minutes: 0,
  coveredMinutes: 0,
  windowMinutes: 1440,
  complete: false,
  belowMinutes: 0,
  aboveMinutes: 0,
};
const meal = {
  id: "m1",
  ts: "2026-10-14T10:10:00.000Z", // 12:10
  title: "Rugbrød",
  slot: "lunch" as const,
  totalCarbs: 50,
  byUser: { id: "u1", name: "Jonas" },
  items: [{ name: "Rugbrød", carbs: 50 }],
  bolusTs: "2026-10-14T09:58:00.000Z",
  pumpBolusId: "b-lunch",
  stats: { inRange: range, readingCount: 0 },
};
const history = (date: string): DayHistoryView => ({
  date,
  timezone: "Europe/Copenhagen",
  from: new Date(new Date(`${date}T00:00:00Z`).getTime() - 2 * 3600000).toISOString(),
  to: `${date}T22:00:00.000Z`,
  target: { low: 4, high: 10 },
  readings: [{ ts: "2026-10-14T11:15:00.000Z", mmol: 6.1, trend: "flat" }],
  inRange: range,
  totalCarbs: 50,
  mealCount: 1,
  meals: date === TODAY ? [meal] : [],
  hasOlder: true,
  now: NOW.toISOString(),
});
const viewerDay = (date: string) => ({
  date,
  timezone: "Europe/Copenhagen",
  totalCarbs: 0,
  mealCount: 0,
  meals: [],
  hasOlder: false,
});

let calls: string[];
let boluses: PumpBolusView[];
let sockets: ReturnType<typeof fakeSocketFactory>;
const request = (input: RequestInfo | URL) => {
  const url = new URL(
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    "https://example.invalid",
  );
  calls.push(`${url.pathname}${url.search}`);
  const path = url.pathname.replace("/api/spaces/s1/", "");
  const date = url.searchParams.get("date") ?? TODAY;
  if (path === "negotiate") return Promise.resolve(Response.json({ url: "wss://example/socket" }));
  if (path === "events")
    return Promise.resolve(Response.json({ lastSeq: 10, events: [], more: false }));
  if (path === "history/day") return Promise.resolve(Response.json(history(date)));
  if (path === "day") return Promise.resolve(Response.json(viewerDay(date)));
  if (path === "members") return Promise.resolve(Response.json({ members: [], invites: [] }));
  if (path === "symptoms") return Promise.resolve(Response.json({ symptoms: [] }));
  if (path === "symptoms/kinds") return Promise.resolve(Response.json({ kinds: [] }));
  if (path === "pump")
    return Promise.resolve(
      Response.json({ boluses, reach: "2026-10-14T09:58:00.000Z", status: "connected" }),
    );
  return Promise.resolve(Response.json({ error: { code: "not-found" } }, { status: 404 }));
};

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  calls = [];
  sockets = fakeSocketFactory();
  boluses = [
    { id: "b-auto", ts: "2026-10-14T01:10:00.000Z", units: 0.6, kind: "automatic" }, // 03:10
    { id: "b-lunch", ts: "2026-10-14T09:58:00.000Z", units: 2.4, kind: "standard", mealId: "m1" },
  ];
  vi.stubGlobal("fetch", request);
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {
        return undefined;
      }
      disconnect() {
        return undefined;
      }
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const props = {
  spaceId: "s1",
  locale: "da" as const,
  today: TODAY,
  initialDate: TODAY,
  fetch: request,
};
const mount = (node: React.ReactNode) =>
  act(async () => {
    render(
      <NextIntlClientProvider locale="da" messages={da}>
        {node}
      </NextIntlClientProvider>,
    );
    await Promise.resolve();
  });
const pumpCalls = () => calls.filter((url) => url.includes("/pump"));
const receive = (type: string, payload: unknown, seq = 11) =>
  act(async () => {
    sockets.sockets[0]?.receive({ spaceId: "s1", seq, type, ts: NOW.toISOString(), payload });
    await Promise.resolve();
  });

describe("history day with the pump record (v0.7.0 plan §9)", () => {
  it("draws every bolus of the day for an owner or carer, the meal's own once, with the reach", async () => {
    await mount(<HistoryScreen {...props} unit="mmol" socketFactory={sockets.factory} />);
    await waitFor(() => {
      expect(screen.getAllByTestId("pump-tap")).toHaveLength(2);
    });
    expect(screen.getAllByTestId("pump-tap").map((b) => b.getAttribute("aria-label"))).toEqual([
      "Automatisk bolus 03:10 · 0,6 E",
      "Bolus 11:58 · 2,4 E",
    ]);
    expect(screen.queryByTestId("bolus")).toBeNull();
    expect(screen.getByTestId("pump-reach-caption")).toHaveTextContent("Pumpe til 11:58");
    const day = history(TODAY);
    expect(pumpCalls()).toEqual([
      `/api/spaces/s1/pump?${new URLSearchParams({ from: day.from, to: day.to }).toString()}`,
    ]);
  });

  it("shows new pump records once pump.imported arrives", async () => {
    await mount(<HistoryScreen {...props} unit="mmol" socketFactory={sockets.factory} />);
    await waitFor(() => {
      expect(screen.getAllByTestId("pump-tap")).toHaveLength(2);
    });
    boluses = [
      ...boluses,
      { id: "b-snack", ts: "2026-10-14T11:00:00.000Z", units: 1, kind: "standard" },
    ];
    await receive("pump.imported", {
      count: 1,
      from: "2026-10-14T11:00:00.000Z",
      to: "2026-10-14T11:00:00.000Z",
    });
    await waitFor(() => {
      expect(screen.getAllByTestId("pump-tap")).toHaveLength(3);
    });
  });

  it("reads every day shown again on pump.meals, not only today", async () => {
    await mount(
      <HistoryScreen
        {...props}
        initialDate="2026-10-13"
        unit="mmol"
        socketFactory={sockets.factory}
      />,
    );
    await waitFor(() => {
      expect(calls.some((url) => url.endsWith("history/day?date=2026-10-13"))).toBe(true);
    });
    const before = calls.filter((url) => url.includes("history/day")).length;
    await receive("pump.meals", { updated: ["m1"], created: [], removed: [] });
    await waitFor(() => {
      expect(calls.filter((url) => url.includes("history/day")).length).toBe(before + 1);
    });
    expect(calls.filter((url) => url.includes("history/day")).at(-1)).toContain("date=2026-10-13");
  });

  it("never asks for the pump record in simpleMode or for a viewer passed to the day", async () => {
    await mount(
      <HistoryScreen {...props} unit="mmol" simpleMode socketFactory={sockets.factory} />,
    );
    await waitFor(() => {
      expect(calls.some((url) => url.includes("history/day"))).toBe(true);
    });
    expect(pumpCalls()).toEqual([]);
    cleanup();
    await mount(
      <HistoryScreen {...props} unit="mmol" role="viewer" socketFactory={sockets.factory} />,
    );
    await waitFor(() => {
      expect(calls.filter((url) => url.includes("history/day")).length).toBeGreaterThan(1);
    });
    expect(pumpCalls()).toEqual([]);
    expect(screen.queryByTestId("pump-tap")).toBeNull();
  });

  it("a viewer's days never request /pump and draw no pump marker", async () => {
    await mount(<ViewerDays {...props} socketFactory={sockets.factory} />);
    await waitFor(() => {
      expect(calls.some((url) => url.includes("/day"))).toBe(true);
    });
    await receive("pump.meals", { updated: ["m1"], created: [], removed: [] });
    expect(pumpCalls()).toEqual([]);
    expect(screen.queryByTestId("pump-tap")).toBeNull();
  });
});

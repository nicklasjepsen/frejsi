import "@testing-library/jest-dom/vitest";

import type { Reading } from "@frejsi/shared";
import { DayHistoryView, type DayHistoryMeal } from "@frejsi/shared/schemas/history";
import type { PumpBolusView } from "@frejsi/shared/schemas/pump";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/lib/i18n/Provider";
import { getMessages } from "@/lib/i18n/messages";
import type { LiveState } from "@/lib/live/live-feed";

const live = vi.hoisted(() => {
  const handlers = new Map<string, Set<() => void>>();
  return {
    state: null as LiveState | null,
    handlers,
    subscribe: (type: string, handler: () => void) => {
      const set = handlers.get(type) ?? new Set();
      set.add(handler);
      handlers.set(type, set);
      return () => {
        set.delete(handler);
      };
    },
    emit(type: string) {
      for (const handler of handlers.get(type) ?? []) handler();
    },
  };
});
vi.mock("@/lib/live/useLiveFeed", () => ({
  useLiveFeed: () => (live.state ? { ...live.state, subscribe: live.subscribe } : live.state),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

import { NOW_HISTORY_REFRESH_ON } from "./useNowHistory";
import { NowScreen, type NowScreenProps } from "./NowScreen";

const T0 = new Date("2026-10-14T13:13:00.000Z"); // 15:13 in Copenhagen
const minutesAgo = (m: number) => new Date(T0.getTime() - m * 60_000).toISOString();
const reading = (m: number, mmol: number): Reading => ({ ts: minutesAgo(m), mmol, trend: "flat" });
const loaded: LiveState = {
  loaded: true,
  connection: "live",
  lastSeq: 40,
  readings: [reading(60, 5.8), reading(8, 6.0), reading(3, 6.2)],
  latest: reading(3, 6.2),
  sourceStatus: "connected",
  sourceSince: minutesAgo(600),
  space: {
    glucoseUnit: "mmol",
    targetLow: 4,
    targetHigh: 10,
    timezone: "Europe/Copenhagen",
    sourceType: "dexcom-share",
  },
  error: null,
};
const inRange = {
  minutes: 0,
  coveredMinutes: 0,
  windowMinutes: 180,
  complete: true,
  belowMinutes: 0,
  aboveMinutes: 0,
};
const lunch: DayHistoryMeal = {
  id: "m-lunch",
  ts: "2026-10-14T10:05:00.000Z", // 12:05
  title: "Rugbrød",
  slot: "lunch",
  totalCarbs: 45,
  byUser: { id: "u1", name: "Jonas" },
  items: [{ name: "Rugbrød", carbs: 45 }],
  bolusTs: "2026-10-14T09:58:00.000Z", // 11:58
  pumpBolusId: "b-lunch",
  stats: { inRange, readingCount: 0 },
};

let calls: string[];
let boluses: PumpBolusView[];
let historyReads: number;

beforeEach(() => {
  vi.useFakeTimers({ now: T0, toFake: ["Date"] });
  live.state = loaded;
  live.handlers.clear();
  calls = [];
  historyReads = 0;
  boluses = [
    {
      id: "b-lunch",
      ts: "2026-10-14T09:58:00.000Z",
      units: 2.4,
      kind: "standard",
      mealId: "m-lunch",
    },
    { id: "b-auto", ts: "2026-10-14T11:30:00.000Z", units: 0.6, kind: "automatic" }, // 13:30
  ];
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      "https://frejsi.example",
    );
    calls.push(`${url.pathname}${url.search}`);
    const path = url.pathname.replace("/api/spaces/s1/", "");
    if (path === "pump")
      return Promise.resolve(
        Response.json({ boluses, reach: "2026-10-14T11:30:00.000Z", status: "connected" }),
      );
    if (path === "history/day") {
      historyReads += 1;
      return Promise.resolve(
        Response.json(
          DayHistoryView.parse({
            date: "2026-10-14",
            timezone: "Europe/Copenhagen",
            from: "2026-10-13T22:00:00.000Z",
            to: "2026-10-14T22:00:00.000Z",
            target: { low: 4, high: 10 },
            readings: [],
            inRange,
            totalCarbs: 45,
            mealCount: 1,
            meals: [lunch],
            hasOlder: false,
            now: T0.toISOString(),
          }),
        ),
      );
    }
    if (path === "day")
      return Promise.resolve(
        Response.json({
          date: "2026-10-14",
          timezone: "Europe/Copenhagen",
          totalCarbs: 0,
          mealCount: 0,
          meals: [],
        }),
      );
    if (path === "foods")
      return Promise.resolve(
        Response.json({
          foods: [],
          counts: { all: 0, own: 0, unverified: 0, favourites: 0, recent: 0 },
        }),
      );
    if (path === "symptoms") return Promise.resolve(Response.json({ symptoms: [] }));
    if (path === "symptoms/kinds") return Promise.resolve(Response.json({ kinds: [] }));
    return Promise.resolve(Response.json({ error: { code: "not-found" } }, { status: 404 }));
  });
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const mount = (props: Partial<NowScreenProps> = {}) => {
  const slot = document.createElement("div");
  slot.id = "shell-header-end";
  document.body.appendChild(slot);
  return render(
    <I18nProvider locale="da" messages={getMessages("da")}>
      <NowScreen
        spaceId="s1"
        locale="da"
        simpleMode={false}
        timeZone="Europe/Copenhagen"
        {...props}
      />
    </I18nProvider>,
  );
};
const pumpCalls = () => calls.filter((url) => url.includes("/pump"));

describe("Nu with the pump record (v0.7.0 plan §9)", () => {
  it.each(["owner", "carer"] as const)(
    "shows an %s every bolus in the window on the desktop day curve, once each, with the legend",
    async (role) => {
      mount({ role });
      const desktop = screen.getByTestId("now-desktop");
      await waitFor(() => {
        expect(within(desktop).getAllByTestId("pump-tap")).toHaveLength(2);
      });
      expect(
        within(desktop)
          .getAllByTestId("pump-tap")
          .map((b) => b.getAttribute("aria-label")),
      ).toEqual(["Bolus 11:58 · 2,4 E", "Automatisk bolus 13:30 · 0,6 E"]);
      // The meal's own triangle is the pump's, drawn once.
      await waitFor(() => {
        expect(within(desktop).getAllByTestId("meal-line")).toHaveLength(1);
      });
      expect(within(desktop).queryByTestId("bolus")).toBeNull();
      expect(within(desktop).getByText("Bolus (pumpe)")).toBeInTheDocument();
      expect(within(desktop).getByText("Automatisk bolus")).toBeInTheDocument();
      expect(within(desktop).queryByText("Bolus givet")).toBeNull();
      expect(within(desktop).getByTestId("pump-reach-caption")).toHaveTextContent(
        "Pumpe til 13:30",
      );
      expect(pumpCalls()).toHaveLength(1);
    },
  );

  it("shows the boluses of the last three hours on the phone's sparkline", async () => {
    mount();
    const phone = screen.getByTestId("now-phone");
    await waitFor(() => {
      expect(within(phone).getAllByTestId("pump-tap")).toHaveLength(1);
    });
    expect(within(phone).getByTestId("pump-tap")).toHaveAccessibleName(
      "Automatisk bolus 13:30 · 0,6 E",
    );
  });

  it("shows new pump records once pump.imported arrives, without a reload", async () => {
    mount();
    const desktop = screen.getByTestId("now-desktop");
    await waitFor(() => {
      expect(within(desktop).getAllByTestId("pump-tap")).toHaveLength(2);
    });
    boluses = [
      ...boluses,
      { id: "b-snack", ts: "2026-10-14T12:40:00.000Z", units: 1, kind: "standard" },
    ];
    act(() => {
      live.emit("pump.imported");
    });
    await waitFor(() => {
      expect(within(desktop).getAllByTestId("pump-tap")).toHaveLength(3);
    });
    expect(pumpCalls()).toHaveLength(2);
  });

  it("reads the day's meals again on pump.meals, and the pump record too", async () => {
    expect(NOW_HISTORY_REFRESH_ON).toContain("pump.meals");
    mount();
    await waitFor(() => {
      expect(historyReads).toBe(1);
    });
    await waitFor(() => {
      expect(pumpCalls()).toHaveLength(1);
    });
    act(() => {
      live.emit("pump.meals");
    });
    await waitFor(() => {
      expect(historyReads).toBe(2);
    });
    await waitFor(() => {
      expect(pumpCalls()).toHaveLength(2);
    });
  });

  it("covers the whole local day on the night daylight saving ends, when it is 25 hours long", async () => {
    // 05:30 in Copenhagen on 25 October 2026, after the clocks went back: the day began at
    // 06:00 the day before, 24 h 30 min ago.
    const at = new Date("2026-10-25T04:30:00.000Z");
    vi.setSystemTime(at);
    mount();
    await waitFor(() => {
      expect(pumpCalls()).toHaveLength(1);
    });
    const query = new URL(pumpCalls()[0] ?? "", "https://frejsi.example").searchParams;
    expect(Date.parse(query.get("from") ?? "")).toBeLessThan(at.getTime() - 24 * 3_600_000);
    expect(Date.parse(query.get("to") ?? "")).toBeGreaterThanOrEqual(at.getTime());
  });

  it("never asks for the pump record in simpleMode", async () => {
    mount({ simpleMode: true });
    await screen.findByTestId("now-simple");
    await act(async () => {
      await Promise.resolve();
    });
    expect(pumpCalls()).toEqual([]);
    expect(live.handlers.get("pump.imported")?.size ?? 0).toBe(0);
  });

  it("never asks for the pump record for a viewer, whatever mounts the screen", async () => {
    mount({ role: "viewer" });
    await waitFor(() => {
      expect(historyReads).toBeGreaterThan(0);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(pumpCalls()).toEqual([]);
    expect(screen.queryByTestId("pump-tap")).toBeNull();
  });
});

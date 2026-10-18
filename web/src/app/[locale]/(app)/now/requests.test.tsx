import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppShell } from "@/components/shell/AppShell";
import { I18nProvider } from "@/lib/i18n/Provider";
import { getMessages } from "@/lib/i18n/messages";
import { fakeFetch, FakeSocket, jsonResponse } from "@/lib/live/test-support";
import { TodayScreen } from "../today/TodayScreen";
import NowPage from "./page";

const session = vi.hoisted(() => ({ role: "owner", simpleMode: false }));
vi.mock("@/components/shell/shell-session", () => ({
  getShellSession: () => Promise.resolve({ simpleMode: session.simpleMode }),
  getShell: () =>
    Promise.resolve({ space: { id: "s1", role: session.role, timezone: "Europe/Copenhagen" } }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => (session.role === "viewer" ? "/da/today" : "/da/now"),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  redirect: (href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`);
  },
}));
vi.mock("@/components/shell/actions", () => ({ switchSpace: vi.fn() }));

const now = new Date("2026-10-14T13:13:00.000Z");
const day = {
  date: "2026-10-14",
  timezone: "Europe/Copenhagen",
  totalCarbs: 0,
  mealCount: 0,
  meals: [],
};
const range = {
  minutes: 0,
  coveredMinutes: 0,
  windowMinutes: 180,
  complete: false,
  belowMinutes: 0,
  aboveMinutes: 0,
};
let net: ReturnType<typeof fakeFetch>;
let sockets: FakeSocket[];
beforeEach(() => {
  vi.useFakeTimers({ now, toFake: ["Date"] });
  session.simpleMode = false;
  sockets = [];
  vi.stubGlobal(
    "WebSocket",
    class extends FakeSocket {
      constructor(url: string) {
        super(url);
        sockets.push(this);
      }
    },
  );
  net = fakeFetch({
    "/history/day": () =>
      jsonResponse({
        ...day,
        from: "2026-10-13T22:00:00.000Z",
        to: "2026-10-14T22:00:00.000Z",
        target: { low: 4, high: 10 },
        readings: [],
        inRange: range,
        hasOlder: false,
        now: now.toISOString(),
      }),
    "/day": () => jsonResponse(day),
    "/symptoms/kinds": () => jsonResponse({ kinds: [] }),
    "/symptoms": () => jsonResponse({ symptoms: [] }),
    "/foods": () =>
      jsonResponse({
        foods: [],
        counts: { all: 0, own: 0, unverified: 0, favourites: 0, recent: 0 },
      }),
    "/negotiate": () => jsonResponse({ url: "wss://example.invalid/hub" }),
    "/events": () => jsonResponse({ lastSeq: 1, events: [], more: false }),
    "/readings": () =>
      jsonResponse({
        lastSeq: 1,
        sourceStatus: "not-configured",
        sourceSince: null,
        space: {
          glucoseUnit: "mmol",
          targetLow: 4,
          targetHigh: 10,
          timezone: "Europe/Copenhagen",
          sourceType: null,
        },
        readings: [],
        latest: null,
      }),
    "/members": () => jsonResponse({ members: [], invites: [] }),
    "/pump": () => jsonResponse({ boluses: [], status: "connected" }),
  });
  vi.stubGlobal("fetch", net.fetch);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it.each(["owner", "carer"] as const)(
  "%s Now requests only day, history/day without readings, foods and the live feed's window/transport",
  async (role) => {
    session.role = role;
    const page = await NowPage({ params: Promise.resolve({ locale: "da" }) });
    render(
      <I18nProvider locale="da" messages={getMessages("da")}>
        {page}
      </I18nProvider>,
    );
    await screen.findByTestId("meals-table");
    await waitFor(() => {
      expect(sockets).toHaveLength(1);
    });
    act(() => sockets[0]?.open());
    await waitFor(() => {
      expect(net.calls.some((url) => url.includes("/events?"))).toBe(true);
    });
    expect(
      new Set(
        net.calls.map((url) =>
          new URL(url, "https://example.invalid").pathname.replace("/api/spaces/s1/", ""),
        ),
      ),
    ).toEqual(
      new Set([
        "day",
        "history/day",
        "foods",
        "negotiate",
        "events",
        "readings",
        // The desktop curve's symptoms (v0.6.0 plan §5): kinds, times and names, never a reading.
        "symptoms",
        "symptoms/kinds",
        // The pump record for both curves (v0.7.0 plan §9), owners and carers only.
        "pump",
      ]),
    );
    // One window, read once: from 03:00 (three hours before the day's 06:00) to 25 hours after
    // that 06:00, the longest local day.
    expect(net.calls.filter((url) => url.includes("/pump"))).toEqual([
      `/api/spaces/s1/pump?${new URLSearchParams({
        from: "2026-10-14T01:00:00.000Z",
        to: "2026-10-15T05:00:00.000Z",
      }).toString()}`,
    ]);
    expect(net.calls.filter((url) => url.includes("/history/"))).toEqual([
      "/api/spaces/s1/history/day?readings=0",
    ]);
    expect(net.calls.filter((url) => url.includes("/readings"))).toEqual([
      "/api/spaces/s1/readings?hours=24",
    ]);
  },
);

it("a simpleMode session on Now never asks for the pump record", async () => {
  session.role = "carer";
  session.simpleMode = true;
  const page = await NowPage({ params: Promise.resolve({ locale: "da" }) });
  render(
    <I18nProvider locale="da" messages={getMessages("da")}>
      {page}
    </I18nProvider>,
  );
  await screen.findByTestId("now-simple");
  await waitFor(() => {
    expect(sockets).toHaveLength(1);
  });
  act(() => sockets[0]?.open());
  await waitFor(() => {
    expect(net.calls.some((url) => url.includes("/events?"))).toBe(true);
  });
  expect(net.calls.filter((url) => url.includes("/pump"))).toEqual([]);
});

it("redirects a viewer to their meal-only day, with their own history navigation and no chart or peak", async () => {
  session.role = "viewer";
  await expect(NowPage({ params: Promise.resolve({ locale: "da" }) })).rejects.toThrow(
    "NEXT_REDIRECT:/da/today",
  );
  render(
    <I18nProvider locale="da" messages={getMessages("da")}>
      <AppShell
        locale="da"
        user={{ name: "Alma", accent: "sea", simpleMode: false }}
        space={{
          id: "s1",
          name: "Test space",
          role: "viewer",
          subjectName: "Alma",
          ownerName: null,
        }}
        spaces={[]}
      >
        <TodayScreen spaceId="s1" locale="da" role="viewer" />
      </AppShell>
    </I18nProvider>,
  );
  await screen.findByTestId("day-total");
  await waitFor(() => {
    expect(sockets).toHaveLength(1);
  });
  act(() => sockets[0]?.open());
  await waitFor(() => {
    expect(net.calls.some((url) => url.includes("/events?"))).toBe(true);
  });
  expect(
    new Set(
      net.calls.map((url) =>
        new URL(url, "https://example.invalid").pathname.replace("/api/spaces/s1/", ""),
      ),
    ),
  ).toEqual(new Set(["day", "members", "negotiate", "events"]));
  expect(document.querySelector("svg[role=img], [data-glucose], [aria-label^=Top]")).toBeNull();
  expect(
    screen
      .getAllByRole("link", { name: "Tidligere dage" })
      .every((link) => link.getAttribute("href") === "/da/history"),
  ).toBe(true);
});

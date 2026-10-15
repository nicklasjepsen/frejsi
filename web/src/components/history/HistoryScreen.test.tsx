import "@testing-library/jest-dom/vitest";
import type { DayHistoryView } from "@frejsi/shared/schemas/history";
import type { DayView } from "@frejsi/shared/schemas/meal";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import da from "../../../messages/da";
import en from "../../../messages/en";
import { fakeSocketFactory } from "@/lib/live/test-support";
import { HistoryScreen } from "./HistoryScreen";
import { ViewerDays } from "./ViewerDays";

const push = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

const scrollIntoView = vi.fn();
const urlOf = (input: RequestInfo | URL) =>
  typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
const NOW = new Date("2026-10-14T11:20:00.000Z");
const TODAY = "2026-10-14";
const meal = {
  id: "m1",
  ts: "2026-10-14T10:10:00.000Z",
  title: "Rugbrød med ost og et æble",
  slot: "lunch" as const,
  totalCarbs: 50,
  byUser: { id: "u1", name: "Jonas" },
  items: [{ name: "Apple", carbs: 50 }],
};
const range = {
  minutes: 530,
  coveredMinutes: 553,
  windowMinutes: 1440,
  complete: false,
  belowMinutes: 23,
  aboveMinutes: 0,
};
function history(date = TODAY): DayHistoryView {
  return {
    date,
    timezone: "Europe/Copenhagen",
    from: new Date(new Date(`${date}T00:00:00Z`).getTime() - 2 * 3600000).toISOString(),
    to: `${date}T22:00:00.000Z`,
    target: { low: 4, high: 10 },
    readings: [{ ts: "2026-10-14T11:15:00.000Z", mmol: 9.6, trend: "flat" }],
    inRange: range,
    totalCarbs: 50,
    mealCount: 1,
    meals: [
      {
        ...meal,
        stats: {
          peak: { mmol: 9.6, ts: "2026-10-14T11:15:00.000Z", minutesAfterMeal: 65 },
          inRange: range,
          readingCount: 1,
        },
      },
    ],
    hasOlder: true,
    now: NOW.toISOString(),
  };
}
let calls: string[];
let reply: (date: string) => unknown;
let observers: { callback: IntersectionObserverCallback; target?: Element }[];
let sockets: ReturnType<typeof fakeSocketFactory>;
let request: typeof fetch;
let desktop: boolean;
beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  refresh.mockClear();
  calls = [];
  desktop = false;
  observers = [];
  reply = history;
  sockets = fakeSocketFactory();
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: desktop, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      entry: (typeof observers)[number];
      constructor(callback: IntersectionObserverCallback) {
        this.entry = { callback };
        observers.push(this.entry);
      }
      observe(target: Element) {
        this.entry.target = target;
      }
      disconnect() {
        delete this.entry.target;
      }
    },
  );
  Element.prototype.scrollIntoView = scrollIntoView;
  scrollIntoView.mockClear();
  request = (input: RequestInfo | URL) => {
    const url = urlOf(input);
    calls.push(url);
    const path = new URL(url, "https://example.invalid");
    if (path.pathname.endsWith("/negotiate"))
      return Promise.resolve(Response.json({ url: "wss://example.invalid/socket" }));
    if (path.pathname.endsWith("/events"))
      return Promise.resolve(Response.json({ lastSeq: 10, events: [], more: false }));
    if (path.pathname.endsWith("/members"))
      return Promise.resolve(Response.json({ members: [], invites: [] }));
    if (path.pathname.endsWith("/day"))
      return Promise.resolve(Response.json(reply(path.searchParams.get("date") ?? TODAY)));
    return Promise.reject(new Error(`Unexpected route: ${url}`));
  };
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function mount(viewer = false, date = TODAY, locale: "da" | "en" = "da") {
  const props = {
    spaceId: "s1",
    locale,
    today: TODAY,
    initialDate: date,
    fetch: request,
    socketFactory: sockets.factory,
  };
  await flush(() => {
    render(
      <NextIntlClientProvider locale={locale} messages={locale === "da" ? da : en}>
        {viewer ? <ViewerDays {...props} /> : <HistoryScreen {...props} unit="mmol" />}
      </NextIntlClientProvider>,
    );
  });
}
async function older() {
  await flush(() => {
    const o = [...observers].reverse().find((o) => o.target);
    o?.callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
  });
}
it("renders the phone curve, timestamped peak detail, caption and meal destinations", async () => {
  await mount();
  expect(screen.getByRole("heading", { name: "Historik" })).toBeVisible();
  expect(screen.getByRole("link", { name: "Ugen" })).toHaveAttribute("href", "/da/history/week");
  expect(screen.getByRole("heading", { name: "Onsdag 14. oktober" })).toBeVisible();
  expect(screen.getByText("I dag · 50 g kulhydrat · 1 måltid")).toBeVisible();
  expect(screen.getByRole("button", { name: "Næste dag" })).toBeDisabled();
  expect(screen.getByRole("img", { name: "Glukose i dag med måltider markeret" })).toHaveAttribute(
    "viewBox",
    "0 0 326 118",
  );
  expect(screen.getByText("I mål 4–10: 8 t 50 min af 9 t 13 min")).toBeVisible();
  expect(screen.getByTestId("chart-caption")).toHaveTextContent(/5 min/);
  const row = screen.getByRole("link", { name: /Rugbrød/ });
  expect(row).toHaveAttribute("href", "/da/meal/m1");
  expect(row).toHaveTextContent("50 g · top 9,6 efter 1 t 05 · Jonas");
  expect(within(row).getByRole("img", { name: "Top 9,6 kl. 13:15" })).toBeVisible();
  expect(screen.queryByText("Ugens opsummering")).toBeNull();
  expect(calls.filter((p) => p.includes("history/day"))).toHaveLength(1);
  expect(calls.every((p) => /\/(history\/day\?date=|negotiate|events\?since=)/.test(p))).toBe(true);
});
it("opens the requested date, navigates both ways, caches dates and scrolls the section", async () => {
  await mount(false, "2026-10-13");
  expect(calls.some((p) => p.endsWith("date=2026-10-13"))).toBe(true);
  await flush(() => {
    fireEvent.click(screen.getByRole("button", { name: "Næste dag" }));
  });
  expect(screen.getAllByTestId("history-day").map((el) => el.dataset.date)).toEqual([
    TODAY,
    "2026-10-13",
  ]);
  await flush(() => {
    fireEvent.click(within(daySection(TODAY)).getByRole("button", { name: "Forrige dag" }));
  });
  expect(calls.filter((p) => p.endsWith("date=2026-10-13"))).toHaveLength(1);
  expect(scrollIntoView).toHaveBeenCalled();
});
it("loads older days on intersection and stops at hasOlder false", async () => {
  reply = (date) => ({ ...history(date), hasOlder: date === TODAY });
  await mount();
  await older();
  await older();
  expect(calls.filter((p) => p.includes("history/day"))).toHaveLength(2);
  expect(screen.getByText("Ikke flere dage")).toBeVisible();
});
it("renders desktop Dag with a 720×220 curve, view links and keyboard meal selection", async () => {
  desktop = true;
  reply = (date) => {
    const day = history(date);
    return {
      ...day,
      meals: [...day.meals, ...day.meals.map((meal) => ({ ...meal, id: "m2", title: "Apple" }))],
    };
  };
  await mount();
  expect(screen.getByRole("radio", { name: "Dag" })).toHaveAttribute("aria-checked", "true");
  expect(screen.getByRole("radio", { name: "Uge" })).toHaveAttribute(
    "href",
    "/da/history/week?view=uge",
  );
  expect(screen.getByRole("radio", { name: "Måltider" })).toHaveAttribute(
    "href",
    "/da/history/week?view=maaltider",
  );
  expect(screen.getByRole("img", { name: "Glukose i dag med måltider markeret" })).toHaveAttribute(
    "viewBox",
    "0 0 720 220",
  );
  const first = screen.getByRole("link", { name: /Rugbrød/ });
  first.focus();
  fireEvent.keyDown(first, { key: "ArrowDown" });
  expect(screen.getByRole("link", { name: /Apple/ })).toHaveFocus();
  await flush(() => {
    fireEvent.keyDown(window, { key: "ArrowLeft" });
  });
  expect(calls.some((p) => p.endsWith("date=2026-10-13"))).toBe(true);
});
it("merges live readings into today and refetches on each meal event", async () => {
  await mount();
  const before = screen.getByTestId("end-dot").getAttribute("cy");
  act(() =>
    sockets.sockets[0]?.receive({
      spaceId: "s1",
      seq: 11,
      type: "reading",
      ts: NOW.toISOString(),
      payload: { ts: NOW.toISOString(), mmol: 11, trend: "flat" },
    }),
  );
  expect(screen.getByTestId("end-dot").getAttribute("cy")).not.toBe(before);
  expect(screen.getByRole("link", { name: /Rugbrød/ })).toHaveTextContent("top 11,0 efter 1 t 10");
  for (const [i, type] of ["meal.created", "meal.updated", "meal.deleted"].entries()) {
    await flush(() => {
      sockets.sockets[0]?.receive({
        spaceId: "s1",
        seq: 12 + i,
        type,
        ts: NOW.toISOString(),
        payload:
          type === "meal.created"
            ? { mealId: "m1", ts: NOW.toISOString(), totalCarbs: 50 }
            : { mealId: "m1" },
      });
    });
  }
  expect(calls.filter((p) => p.includes("history/day"))).toHaveLength(4);
});
it.each(["da", "en"] as const)("shows empty day states in %s", async (locale) => {
  reply = (date) => ({
    ...history(date),
    readings: [],
    meals: [],
    mealCount: 0,
    totalCarbs: 0,
    hasOlder: false,
  });
  await mount(false, TODAY, locale);
  expect(
    screen.getByText(locale === "da" ? "Ingen målinger denne dag" : "No readings this day"),
  ).toBeVisible();
  expect(
    screen.getByText(locale === "da" ? "Ingen måltider i dag endnu" : "No meals today yet"),
  ).toBeVisible();
  expect(screen.queryByTestId("chart-caption")).toBeNull();
});
it("preserves the day skeleton while loading", async () => {
  request = vi.fn(
    () =>
      new Promise<Response>(() => {
        /* An intentionally pending request. */
      }),
  );
  await mount();
  expect(screen.getByTestId("history-loading")).toHaveAttribute("aria-busy", "true");
});
it("viewer reads today and yesterday then older days, stops after seven empty days, and draws only meals and totals", async () => {
  reply = (date): DayView => ({
    date,
    timezone: "Europe/Copenhagen",
    totalCarbs: date === TODAY ? 50 : 0,
    mealCount: date === TODAY ? 1 : 0,
    meals: date === TODAY ? [meal] : [],
  });
  await mount(true);
  expect(screen.getByRole("heading", { name: "Tidligere dage" })).toBeVisible();
  expect(calls.some((p) => p.endsWith("day?date=2026-10-13"))).toBe(true);
  expect(screen.getAllByTestId("day-total")).toHaveLength(2);
  expect(screen.getByText(/Blodsukker vises ikke her/)).toBeVisible();
  expect(screen.queryByTestId("glucose-number")).toBeNull();
  expect(screen.queryByTestId("chart-caption")).toBeNull();
  expect(document.querySelector("svg[data-variant]")).toBeNull();
  expect(screen.queryByText(/top 9/)).toBeNull();
  expect(screen.queryByRole("link", { name: /Rugbrød/ })).toBeNull();
  for (let i = 0; i < 9; i++) await older();
  expect(calls.filter((p) => p.includes("/day?date="))).toHaveLength(8);
  expect(screen.getByText("Ikke flere dage")).toBeVisible();
  expect(calls.every((p) => /\/(day\?date=|members$|negotiate$|events\?since=)/.test(p))).toBe(
    true,
  );
});
it("a chart meal-line tap opens the same meal as the timeline", async () => {
  await mount();
  fireEvent.click(screen.getByRole("button", { name: "Måltid kl. 12:10" }));
  expect(push).toHaveBeenCalledWith("/da/meal/m1");
});
it("does not refresh past days on a meal event", async () => {
  await mount(false, "2026-10-13");
  await flush(() => {
    sockets.sockets[0]?.receive({
      spaceId: "s1",
      seq: 11,
      type: "meal.updated",
      ts: NOW.toISOString(),
      payload: { mealId: "m1" },
    });
  });
  expect(calls.filter((p) => p.includes("history/day"))).toHaveLength(1);
});
it("shows a retry after a failed day read and recovers", async () => {
  const network = request;
  let failed = true;
  request = (...args) =>
    urlOf(args[0]).includes("history/day") && failed
      ? Promise.resolve(Response.json({}, { status: 500 }))
      : network(...args);
  await mount();
  expect(screen.getByRole("alert")).toHaveTextContent("Dagen kunne ikke hentes");
  failed = false;
  await flush(() => {
    fireEvent.click(screen.getByRole("button", { name: "Prøv igen" }));
  });
  expect(screen.getByRole("link", { name: /Rugbrød/ })).toBeVisible();
});
it("clears cached glucose when a membership change makes history forbidden", async () => {
  const network = request;
  let forbidden = false;
  request = (...args) =>
    urlOf(args[0]).includes("history/day") && forbidden
      ? Promise.resolve(Response.json({}, { status: 403 }))
      : network(...args);
  await mount();
  forbidden = true;
  await flush(() => {
    sockets.sockets[0]?.receive({
      spaceId: "s1",
      seq: 11,
      type: "member.updated",
      ts: NOW.toISOString(),
      payload: { userId: "u1" },
    });
  });
  expect(screen.queryByTestId("history-day")).toBeNull();
  expect(screen.getByRole("alert")).toBeVisible();
});
it("viewer history clears its meals on a refused refresh", async () => {
  reply = (date): DayView => ({
    date,
    timezone: "Europe/Copenhagen",
    totalCarbs: 50,
    mealCount: 1,
    meals: [meal],
  });
  const network = request;
  let forbidden = false;
  request = (...args) =>
    urlOf(args[0]).includes("/day?") && forbidden
      ? Promise.resolve(Response.json({}, { status: 403 }))
      : network(...args);
  await mount(true);
  forbidden = true;
  await flush(() => {
    sockets.sockets[0]?.receive({
      spaceId: "s1",
      seq: 11,
      type: "meal.updated",
      ts: NOW.toISOString(),
      payload: { mealId: "m1" },
    });
  });
  expect(screen.queryByTestId("meal-card")).toBeNull();
  expect(screen.getByRole("alert")).toBeVisible();
});
it("uses the space's unit for bounds and timestamped peaks", async () => {
  await flush(() => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <HistoryScreen
          spaceId="s1"
          locale="en"
          today={TODAY}
          initialDate={TODAY}
          unit="mgdl"
          fetch={request}
          socketFactory={sockets.factory}
        />
      </NextIntlClientProvider>,
    );
  });
  expect(screen.getByRole("img", { name: "Peak 173 at 13:15" })).toBeVisible();
  expect(screen.getByText("Target 72–180")).toBeVisible();
});
it("a past day's chart spans midnight to midnight and has no live caption", async () => {
  await mount(false, "2026-10-13");
  const chart = screen.getByRole("img", { name: "Glukose i dag med måltider markeret" });
  expect(chart).toHaveTextContent("00:00");
  expect(screen.queryByTestId("chart-caption")).toBeNull();
});
it("updates the open current day when the space crosses midnight", async () => {
  vi.useRealTimers();
  vi.useFakeTimers({
    now: new Date("2026-10-14T21:59:50Z"),
    toFake: ["Date", "setInterval", "clearInterval"],
  });
  await mount();
  await flush(() => {
    vi.advanceTimersByTime(30_000);
  });
  expect(calls.some((p) => p.endsWith("date=2026-10-15"))).toBe(true);
  expect(screen.getByRole("heading", { name: "Torsdag 15. oktober" })).toBeVisible();
});

async function flush(action: () => void) {
  await act(async () => {
    action();
    await Promise.resolve();
  });
}
function daySection(date: string) {
  const section = screen.getAllByTestId("history-day").find((el) => el.dataset.date === date);
  if (!section) throw new Error(`Missing section ${date}`);
  return section;
}
it("takes its initial snapshot after the live cursor, so meals committed during connection are included", async () => {
  const network = request;
  let finishCursor: ((response: Response) => void) | undefined;
  request = (...args) =>
    urlOf(args[0]).includes("/events")
      ? new Promise<Response>((resolve) => {
          finishCursor = resolve;
        })
      : network(...args);
  await mount();
  expect(calls.filter((p) => p.includes("history/day"))).toHaveLength(0);
  await flush(() => {
    finishCursor?.(Response.json({ lastSeq: 10, events: [], more: false }));
  });
  expect(calls.filter((p) => p.includes("history/day"))).toHaveLength(1);
  expect(screen.getByRole("link", { name: /Rugbrød/ })).toBeVisible();
});
it("cached arrow jumps still scroll when that date is already selected", async () => {
  await mount();
  await flush(() => {
    fireEvent.click(within(daySection(TODAY)).getByRole("button", { name: "Forrige dag" }));
  });
  scrollIntoView.mockClear();
  await flush(() => {
    fireEvent.click(within(daySection(TODAY)).getByRole("button", { name: "Forrige dag" }));
  });
  expect(scrollIntoView).toHaveBeenCalled();
});

it("refreshes cached targets and the server-provided presentation unit on space changes", async () => {
  let high = 10;
  reply = (date) => ({ ...history(date), target: { low: 4, high } });
  await mount();
  high = 8;
  await flush(() => {
    sockets.sockets[0]?.receive({
      spaceId: "s1",
      seq: 11,
      type: "space.updated",
      ts: NOW.toISOString(),
      payload: { fields: ["targetHigh", "glucoseUnit"] },
    });
  });
  expect(screen.getByText("Mål 4–8")).toBeVisible();
  expect(refresh).toHaveBeenCalled();
});

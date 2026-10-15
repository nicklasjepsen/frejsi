import "@testing-library/jest-dom/vitest";

import { readFileSync } from "node:fs";
import path from "node:path";

import type { Reading } from "@frejsi/shared";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/lib/i18n/Provider";
import { getMessages } from "@/lib/i18n/messages";
import type { AppLocale } from "@/lib/i18n/routing";
import type { LiveState } from "@/lib/live/live-feed";

const live = vi.hoisted(() => {
  const handlers = new Map<string, Set<() => void>>();
  const subscribe = (type: string, handler: () => void) => {
    const set = handlers.get(type) ?? new Set();
    set.add(handler);
    handlers.set(type, set);
    return () => {
      set.delete(handler);
    };
  };
  return {
    state: null as LiveState | null,
    calls: [] as unknown[],
    handlers,
    subscribe,
    /** Delivers an event of `type` to every subscriber, as the feed does. */
    emit(type: string) {
      for (const handler of handlers.get(type) ?? []) handler();
    },
  };
});
vi.mock("@/lib/live/useLiveFeed", () => ({
  useLiveFeed: (...args: unknown[]) => {
    live.calls.push(args);
    return live.state ? { ...live.state, subscribe: live.subscribe } : live.state;
  },
}));
const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push, replace: vi.fn(), prefetch: vi.fn() }),
}));

import { fakeApi, food, meal, type FakeApi } from "@/components/simple/test-support";

import { NowScreen, type NowScreenProps } from "./NowScreen";

const T0 = new Date("2026-10-14T13:13:00.000Z"); // Wednesday 15:13 in Copenhagen
const minutesAgo = (m: number) => new Date(T0.getTime() - m * 60_000).toISOString();
const reading = (m: number, mmol: number, trend: Reading["trend"] = "flat"): Reading => ({
  ts: minutesAgo(m),
  mmol,
  trend,
});

const space: NonNullable<LiveState["space"]> = {
  glucoseUnit: "mmol",
  targetLow: 4,
  targetHigh: 10,
  timezone: "Europe/Copenhagen",
  sourceType: "dexcom-share",
};

const loaded: LiveState = {
  loaded: true,
  connection: "live",
  lastSeq: 40,
  readings: [reading(60, 5.8), reading(8, 6.0), reading(3, 6.2, "forty-five-up")],
  latest: reading(3, 6.2, "forty-five-up"),
  sourceStatus: "connected",
  sourceSince: minutesAgo(600),
  space,
  error: null,
};

const base: NowScreenProps = {
  spaceId: "s1",
  locale: "da",
  simpleMode: false,
  timeZone: "Europe/Copenhagen",
};

function mount(props: Partial<NowScreenProps> = {}, locale: AppLocale = "da") {
  // The phone header's slot, as the shell renders it.
  const slot = document.createElement("div");
  slot.id = "shell-header-end";
  document.body.appendChild(slot);
  const utils = render(
    <I18nProvider locale={locale} messages={getMessages(locale)}>
      <NowScreen {...base} {...props} locale={locale} />
    </I18nProvider>,
  );
  return { ...utils, slot };
}

let api: FakeApi;
beforeEach(() => {
  vi.useFakeTimers({ now: T0, toFake: ["Date"] });
  live.state = loaded;
  live.calls.length = 0;
  live.handlers.clear();
  navigation.push.mockClear();
  api = fakeApi();
  vi.stubGlobal("fetch", api.fetch);
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// Wednesday 14 October in Copenhagen: 07:15, 09:50 and 12:10 local.
const breakfast = meal("m1", "2026-10-14T05:15:00.000Z", "Havregrød med æble", 38, "Mette");
const apple = meal("m2", "2026-10-14T07:50:00.000Z", "Æble", 14, "Alma");
const lunch = meal("m3", "2026-10-14T10:10:00.000Z", "Rugbrød med ost og et æble", 50, "Jonas");

describe("Nu · phone (Main)", () => {
  it("reads glucose only from useLiveFeed, with the 24-hour window the day curve needs", () => {
    mount();
    expect(live.calls[0]).toEqual(["s1", { hours: 24 }]);
    const source = readFileSync(path.join(import.meta.dirname, "NowScreen.tsx"), "utf8");
    expect(source).not.toMatch(/\bfetch\(/);
    expect(source).not.toMatch(/\/api\//);
  });

  it("shows the number, the arrow, 'mmol/L · for 3 min. siden · stiger langsomt' and 'Lige nu'", () => {
    mount();
    const phone = within(screen.getByTestId("now-phone"));
    expect(phone.getByText("Lige nu")).toBeInTheDocument();
    expect(phone.getByTestId("glucose-number")).toHaveTextContent("6,2");
    expect(phone.getByRole("img", { name: "stiger langsomt" })).toBeInTheDocument();
    expect(phone.getByTestId("glucose-age")).toHaveTextContent(
      "mmol/L · for 3 min. siden · stiger langsomt",
    );
  });

  it("draws the three-hour sparkline with the space's target band and 'Mål 4–10'", () => {
    mount();
    const phone = within(screen.getByTestId("now-phone"));
    expect(phone.getByText("Seneste 3 timer")).toBeInTheDocument();
    expect(phone.getByText("Mål 4–10")).toBeInTheDocument();
    const chart = phone.getByRole("img", { name: "Glukose de seneste 3 timer" });
    expect(chart).toHaveAttribute("data-variant", "sparkline");
    expect(within(chart).getByTestId("target-band")).toBeInTheDocument();
    expect(chart.textContent).toContain("15:13");
  });

  it("puts '{source} forbundet' into the phone header and shows no banner while connected", () => {
    const { slot } = mount();
    expect(within(slot).getByRole("status")).toHaveTextContent("Dexcom Share forbundet");
    expect(screen.queryByText(/Ingen forbindelse/)).toBeNull();
  });

  it("shows the disconnected banner for owners and carers, and no pill", () => {
    live.state = { ...loaded, sourceStatus: "disconnected", sourceSince: minutesAgo(68) };
    const { slot } = mount();
    expect(screen.getByText("Ingen forbindelse til Dexcom Share siden 14:05")).toBeInTheDocument();
    expect(slot).toBeEmptyDOMElement();
  });

  it("says 'Ingen målinger endnu' on a new space, with the band still drawn", () => {
    live.state = {
      ...loaded,
      readings: [],
      latest: null,
      sourceStatus: "not-configured",
      space: { ...space, sourceType: null },
    };
    mount();
    expect(screen.getAllByText("Ingen målinger endnu").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("glucose-number")).toBeNull();
    expect(screen.getAllByTestId("target-band").length).toBeGreaterThan(0);
  });

  it("shows the last reading with its age when it is older than the 24-hour window", () => {
    const old = { ts: minutesAgo(26 * 60), mmol: 7.7, trend: "flat" } satisfies Reading;
    live.state = { ...loaded, readings: [], latest: old, sourceStatus: "disconnected" };
    mount();
    expect(screen.queryByText("Ingen målinger endnu")).toBeNull();
    const phone = within(screen.getByTestId("now-phone"));
    expect(phone.getByTestId("glucose-number")).toHaveTextContent("7,7");
    expect(phone.getByTestId("glucose-age")).toHaveTextContent("for mere end et døgn siden");
  });

  it("shows the last meal from GET day as a card that opens it on the log screen", async () => {
    api.meals = [breakfast, apple, lunch];
    mount();
    const region = within(screen.getByTestId("last-meal"));
    expect(region.getByText("Sidste måltid")).toBeInTheDocument();
    const card = await region.findByRole("link");
    expect(card).toHaveAttribute("href", "/da/log?meal=m3");
    expect(card).toHaveTextContent("Rugbrød med ost og et æble");
    expect(card).toHaveTextContent("12:10 · 50 g kulhydrat · Jonas");
    expect(within(card).getByTestId("meal-card")).toHaveAttribute("data-variant", "card");
  });

  it("says 'Ingen måltider i dag endnu' on an empty day, and offers 'Log et måltid'", async () => {
    mount();
    const region = within(screen.getByTestId("last-meal"));
    expect(await region.findByText("Ingen måltider i dag endnu")).toBeInTheDocument();
    const phone = screen.getAllByRole("link", { name: "Log et måltid" });
    expect(phone.map((a) => a.getAttribute("href"))).toEqual(["/da/log", "/da/log"]);
  });

  it("reads the day again when a meal event arrives, and keeps the glucose age on screen", async () => {
    mount();
    await within(screen.getByTestId("last-meal")).findByText("Ingen måltider i dag endnu");
    api.meals = [lunch];
    act(() => {
      live.emit("meal.created");
    });
    expect(
      await within(screen.getByTestId("last-meal")).findByText("Rugbrød med ost og et æble"),
    ).toBeInTheDocument();
    expect(api.calls.filter((c) => c.path === "day")).toHaveLength(2);
    expect(within(screen.getByTestId("now-phone")).getByTestId("glucose-age")).toHaveTextContent(
      "for 3 min. siden",
    );
  });

  it("writes nothing: Nu only reads day and foods", async () => {
    api.meals = [lunch];
    mount();
    await within(screen.getByTestId("last-meal")).findByRole("link");
    expect(api.calls.every((c) => c.method === "GET")).toBe(true);
    expect(new Set(api.calls.map((c) => c.path))).toEqual(new Set(["day", "foods"]));
  });

  it("draws nothing of glucose before the window has loaded, and the error by code when refused", () => {
    live.state = { ...loaded, loaded: false, readings: [], latest: null };
    const { unmount } = mount();
    expect(screen.getByTestId("now-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("glucose-age")).toBeNull();
    expect(screen.queryByText("Ingen målinger endnu")).toBeNull();
    unmount();
    live.state = { ...loaded, loaded: false, readings: [], latest: null, error: "forbidden" };
    mount();
    expect(screen.getByRole("alert")).toHaveTextContent(/ikke adgang/);
  });
});

describe("Nu · desktop (Nu-Desktop)", () => {
  it("shows the glucose card with the age line, the trend word on its own and the status line", () => {
    mount();
    const desktop = within(screen.getByTestId("now-desktop"));
    expect(desktop.getByRole("heading", { level: 1 })).toHaveTextContent("Lige nu");
    expect(desktop.getByText(/^Onsdag .*14\. oktober$/)).toBeInTheDocument();
    expect(desktop.getByText("Glukose")).toBeInTheDocument();
    expect(desktop.getByTestId("glucose-age")).toHaveTextContent("mmol/L · for 3 min. siden");
    expect(desktop.getByText("Stiger langsomt")).toBeInTheDocument();
    expect(desktop.getByRole("status")).toHaveTextContent("Dexcom Share · sidste måling 15:10");
  });

  it("draws the day curve from 06:00 to now with 'Mål 4–10 mmol/L'", () => {
    mount();
    const desktop = within(screen.getByTestId("now-desktop"));
    expect(desktop.getByText("I dag")).toBeInTheDocument();
    expect(desktop.getByText("Mål 4–10 mmol/L")).toBeInTheDocument();
    const chart = desktop.getByRole("img", { name: "Glukose i dag fra 06:00 til 15:13" });
    expect(chart).toHaveAttribute("data-variant", "day");
    expect(chart.textContent).toContain("06:00");
    expect(chart.textContent).toContain("15:13");
  });

  it("starts the day curve no earlier than the 24-hour window on the night daylight saving ends", () => {
    // 05:30 in Copenhagen on 25 October: yesterday's 06:00 is 24.5 hours back, past the window.
    const night = new Date("2026-10-25T04:30:00.000Z");
    vi.setSystemTime(night);
    const ago = (m: number) => new Date(night.getTime() - m * 60_000).toISOString();
    live.state = {
      ...loaded,
      readings: [
        { ts: ago(24 * 60), mmol: 6.0, trend: "flat" },
        { ts: ago(3), mmol: 6.2, trend: "flat" },
      ],
      latest: { ts: ago(3), mmol: 6.2, trend: "flat" },
    };
    mount();
    const desktop = within(screen.getByTestId("now-desktop"));
    expect(
      desktop.getByRole("img", { name: "Glukose i dag fra 06:30 til 05:30" }),
    ).toBeInTheDocument();
  });

  it("puts 'Søg mad eller skriv en stregkode' with kbd / in the header, and Enter opens the log screen", () => {
    mount();
    const desktop = within(screen.getByTestId("now-desktop"));
    const search = desktop.getByRole("searchbox", { name: "Søg mad eller skriv en stregkode" });
    expect(desktop.getByText("/")).toBeInTheDocument();
    expect(desktop.getByRole("link", { name: "Log et måltid" })).toHaveAttribute("href", "/da/log");
    fireEvent.keyDown(document.body, { key: "/" });
    expect(search).toHaveFocus();
    fireEvent.change(search, { target: { value: "rugbrød" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(navigation.push).toHaveBeenLastCalledWith("/da/log?q=rugbr%C3%B8d");
    fireEvent.change(search, { target: { value: "2000000000015" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(navigation.push).toHaveBeenLastCalledWith("/da/log?barcode=2000000000015");
    fireEvent.change(search, { target: { value: "2000000000016" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(navigation.push).toHaveBeenLastCalledWith("/da/log?q=2000000000016");
  });

  it("lists 'Dagens måltider · 102 g kulhydrat i alt' oldest first, with the keyboard hint", async () => {
    api.meals = [breakfast, apple, lunch];
    mount();
    const table = within(await screen.findByTestId("meals-table"));
    expect(table.getByRole("heading", { name: "Dagens måltider" })).toBeInTheDocument();
    expect(table.getByText("102 g kulhydrat i alt")).toBeInTheDocument();
    expect(table.getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Tid",
      "Måltid",
      "Kulhydrat",
      "Logget af",
    ]);
    const rows = table.getAllByRole("row").slice(1);
    expect(rows.map((row) => row.textContent)).toEqual([
      "07:15Havregrød med æble38 gMette",
      "09:50Æble14 gAlma",
      "12:10Rugbrød med ost og et æble50 gJonas",
    ]);
    expect(table.getByRole("link", { name: "Æble" })).toHaveAttribute("href", "/da/log?meal=m2");
    expect(table.getByText("Pil op/ned vælger et måltid · Enter åbner det")).toBeInTheDocument();
  });

  it("moves between meals with the arrow keys and opens one with Enter", async () => {
    api.meals = [breakfast, apple, lunch];
    mount();
    const rows = within(await screen.findByTestId("meals-table"))
      .getAllByRole("row")
      .slice(1);
    act(() => {
      rows[0]?.focus();
    });
    fireEvent.keyDown(rows[0] ?? document.body, { key: "ArrowDown" });
    expect(rows[1]).toHaveFocus();
    fireEvent.keyDown(rows[1] ?? document.body, { key: "ArrowDown" });
    fireEvent.keyDown(rows[2] ?? document.body, { key: "ArrowDown" });
    expect(rows[2]).toHaveFocus();
    fireEvent.keyDown(rows[2] ?? document.body, { key: "ArrowUp" });
    fireEvent.keyDown(rows[1] ?? document.body, { key: "Enter" });
    expect(navigation.push).toHaveBeenCalledWith("/da/log?meal=m2");
  });

  it("links '3 Fødevarer der ikke er tjekket · Gennemgå og godkend' to the unverified library, and hides it at zero", async () => {
    api.foods = [
      food("a", "Rugbrød", { verified: false }),
      food("b", "Pasta", { verified: false }),
      food("c", "Ost", { verified: false }),
      food("d", "Æble"),
    ];
    const { unmount } = mount();
    const card = await screen.findByRole("complementary", { name: "3 fødevarer er ikke tjekket" });
    const link = within(card).getByRole("link");
    expect(link).toHaveAttribute("href", "/da/library?filter=unverified");
    expect(link).toHaveTextContent("3");
    expect(link).toHaveTextContent("Fødevarer der ikke er tjekket");
    expect(link).toHaveTextContent("Gennemgå og godkend");
    expect(api.calls.find((c) => c.path === "foods")?.query).toEqual({ filter: "unverified" });
    unmount();
    api.foods = [food("d", "Æble")];
    mount();
    await screen.findByTestId("meals-table");
    await waitFor(() => {
      expect(api.calls.filter((c) => c.path === "foods")).toHaveLength(2);
    });
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(screen.queryByText("Ugens opsummering")).toBeNull();
  });

  it("renders an mg/dL space as whole numbers everywhere", () => {
    live.state = { ...loaded, space: { ...space, glucoseUnit: "mgdl" } };
    mount({}, "en");
    for (const number of screen.getAllByTestId("glucose-number")) {
      expect(number).toHaveTextContent("112");
    }
    expect(screen.getByText("Target 72–180")).toBeInTheDocument();
    expect(screen.getByText("Target 72–180 mg/dL")).toBeInTheDocument();
  });
});

describe("Nu · simpleMode (Nu-Simpel, Nu-Simpel-Desktop)", () => {
  it("shows 'Dit tal', the big number without the unit, and only 'Jeg spiser nu'", () => {
    mount({ simpleMode: true });
    const simple = within(screen.getByTestId("now-simple"));
    expect(simple.getByText("Dit tal")).toBeInTheDocument();
    expect(simple.getByTestId("glucose-number")).toHaveTextContent("6,2");
    expect(simple.getByTestId("glucose-number").parentElement?.parentElement).toHaveAttribute(
      "data-size",
      "simple",
    );
    expect(simple.getByTestId("glucose-age")).toHaveTextContent(
      "for 3 min. siden · stiger langsomt",
    );
    expect(simple.getByTestId("glucose-age")).not.toHaveTextContent("mmol");
    const links = simple.getAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual(["Jeg spiser nu"]);
    expect(links[0]).toHaveAttribute("href", "/da/eat");
    expect(simple.queryByText("Spørg en voksen")).toBeNull();
  });

  it("shows the last meal as 'Du spiste kl. 12:10 · {title}' with its photo", async () => {
    api.meals = [
      breakfast,
      {
        ...lunch,
        photo: {
          thumbUrl: "https://photos.example.invalid/t.jpg",
          originalUrl: "https://photos.example.invalid/o.jpg",
        },
      },
    ];
    mount({ simpleMode: true });
    const card = await within(screen.getByTestId("now-simple")).findByTestId("meal-card");
    expect(card).toHaveAttribute("data-variant", "simple");
    expect(card).toHaveTextContent("Du spiste kl. 12:10");
    expect(card).toHaveTextContent("Rugbrød med ost og et æble");
    expect(within(card).getByRole("img")).toHaveAttribute(
      "src",
      "https://photos.example.invalid/t.jpg",
    );
  });

  it("shows 'Min mad' tiles of the verified foods that open the picker with that food selected", async () => {
    api.simpleMode = true;
    api.foods = [
      food("pack", "Min madpakke"),
      food("cake", "Kage", { verified: false, favourite: true }),
      food("pasta", "Pasta bolognese"),
    ];
    mount({ simpleMode: true });
    const region = within(await screen.findByTestId("my-food"));
    expect(region.getByRole("heading", { name: "Min mad" })).toBeInTheDocument();
    const tiles = region.getAllByRole("button");
    expect(tiles.map((b) => b.getAttribute("data-size"))).toEqual(["140", "140"]);
    expect(region.queryByText("Kage")).toBeNull();
    fireEvent.click(region.getByRole("button", { name: /Pasta bolognese/ }));
    expect(navigation.push).toHaveBeenCalledWith("/da/eat?food=pasta");
  });

  it("has no chart, no status line, no banner and no header pill", () => {
    live.state = { ...loaded, sourceStatus: "disconnected" };
    const { slot } = mount({ simpleMode: true });
    expect(screen.queryByRole("img", { name: /Glukose/ })).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText(/Ingen forbindelse/)).toBeNull();
    expect(slot).toBeEmptyDOMElement();
    expect(screen.queryByText("Sidste måltid")).toBeNull();
  });
});

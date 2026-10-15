import "@testing-library/jest-dom/vitest";

import { readFileSync } from "node:fs";
import path from "node:path";

import type { Reading } from "@frejsi/shared";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/lib/i18n/Provider";
import { getMessages } from "@/lib/i18n/messages";
import type { AppLocale } from "@/lib/i18n/routing";
import type { LiveState } from "@/lib/live/live-feed";

const live = vi.hoisted(() => ({
  state: null as LiveState | null,
  calls: [] as unknown[],
}));
vi.mock("@/lib/live/useLiveFeed", () => ({
  useLiveFeed: (...args: unknown[]) => {
    live.calls.push(args);
    return live.state;
  },
}));

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

beforeEach(() => {
  vi.useFakeTimers({ now: T0 });
  live.state = loaded;
  live.calls.length = 0;
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("Nu · phone (Main)", () => {
  it("reads only from useLiveFeed, with the 24-hour window the day curve needs", () => {
    mount();
    expect(live.calls).toEqual([["s1", { hours: 24 }]]);
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
      sourceStatus: "not-configured",
      space: { ...space, sourceType: null },
    };
    mount();
    expect(screen.getAllByText("Ingen målinger endnu").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("glucose-number")).toBeNull();
    expect(screen.getAllByTestId("target-band").length).toBeGreaterThan(0);
  });

  it("keeps the last meal as a placeholder until v0.2.0", () => {
    mount();
    expect(screen.getByText("Sidste måltid")).toBeInTheDocument();
    expect(screen.getByText("Måltider kommer i en senere version.")).toBeInTheDocument();
  });

  it("draws nothing of glucose before the window has loaded, and the error by code when refused", () => {
    live.state = { ...loaded, loaded: false, readings: [] };
    const { unmount } = mount();
    expect(screen.getByTestId("now-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("glucose-age")).toBeNull();
    expect(screen.queryByText("Ingen målinger endnu")).toBeNull();
    unmount();
    live.state = { ...loaded, loaded: false, readings: [], error: "forbidden" };
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
    };
    mount();
    const desktop = within(screen.getByTestId("now-desktop"));
    expect(desktop.getByRole("img", { name: "Glukose i dag fra 06:30 til 05:30" })).toBeInTheDocument();
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
    expect(links[0]).toHaveAttribute("href", "/da/soon/meals");
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

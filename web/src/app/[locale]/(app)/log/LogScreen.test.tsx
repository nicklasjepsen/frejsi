import "@testing-library/jest-dom/vitest";
import type { Reading } from "@frejsi/shared/schemas/glucose";
import type { FoodView, LookupResponse } from "@frejsi/shared/schemas/food";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchFake, type FetchFake } from "@/components/meal/test-support";
import type { LiveState } from "@/lib/live/live-feed";

import da from "../../../../../messages/da";
import { LogScreen, type LogScreenProps } from "./LogScreen";

/** Gives jsdom's navigator a camera for one test; removed again in afterEach. */
function stubMedia(media: unknown) {
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: media });
}

vi.mock("@/lib/photos/downscale", () => ({
  downscale: () =>
    Promise.resolve({ arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3]).buffer) }),
}));

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav }));

const live = vi.hoisted(() => {
  const handlers = new Map<string, () => void>();
  return {
    state: null as LiveState | null,
    handlers,
    subscribe: (type: string, handler: () => void) => {
      handlers.set(type, handler);
      return () => {
        handlers.delete(type);
      };
    },
  };
});
vi.mock("@/lib/live/useLiveFeed", () => ({
  useLiveFeed: () => ({ ...live.state, subscribe: live.subscribe }),
}));

// 12:10 in Copenhagen on a Wednesday: lunch.
const T0 = new Date("2026-10-14T10:10:00.000Z");

const food = (over: Partial<FoodView> & { id: string; name: string }): FoodView => ({
  portions: [],
  origin: "family",
  verified: true,
  favourite: false,
  createdAt: "2026-10-14T08:00:00.000Z",
  updatedAt: "2026-10-14T08:00:00.000Z",
  ...over,
});
const lunchbox = food({
  id: "f-box",
  name: "Min madpakke",
  portions: [{ label: "1 madpakke", carbs: 42 }],
  favourite: true,
});
const toast = food({
  id: "f-toast",
  name: "Rugbrød med ost",
  portions: [{ label: "1 skive", carbs: 18 }],
  favourite: true,
});
const apple = food({ id: "f-apple", name: "Æble", portions: [{ label: "1 mellem", carbs: 14 }] });
const offBread = {
  name: "Rugbrød, Fiktivt Bageri",
  carbsPer100g: 40,
  portions: [
    { label: "½ skive", carbs: 9 },
    { label: "1 skive", carbs: 18 },
    { label: "2 skiver", carbs: 36 },
  ],
  origin: "off",
  sourceRef: "off:2000000000015",
};
const { sourceRef: _sourceRef, ...breadFields } = offBread;
const pickedBread = food({ ...breadFields, id: "f-bread", verified: false });

const lookup = (over: Partial<LookupResponse> = {}): LookupResponse => ({
  results: [
    { source: "library", verified: true, food: toast },
    { source: "off", verified: false, food: offBread },
  ],
  sources: { off: "ok" },
  manual: { name: "rugbrød" },
  ...over,
});

const base: LogScreenProps = {
  spaceId: "s1",
  locale: "da",
  timeZone: "Europe/Copenhagen",
  userName: "Jonas",
  simpleMode: false,
  layout: "phone",
};

let fake: FetchFake;
function api(foods: { favourites?: FoodView[]; recent?: FoodView[] } = {}) {
  fake = fetchFake()
    .on("GET /api/spaces/s1/foods", (_call: unknown, url: URL) => {
      const filter = url.searchParams.get("filter");
      if (filter === "favourites") return foods.favourites ?? [];
      if (filter === "recent") return foods.recent ?? [];
      return [lunchbox, toast, apple];
    })
    .on("GET /api/spaces/s1/lookup", lookup())
    .on("POST /api/spaces/s1/foods", pickedBread, 201)
    .on("POST /api/spaces/s1/meals", {}, 201);
  fake.install();
  return fake;
}

const mount = (props: Partial<LogScreenProps> = {}) =>
  render(
    <NextIntlClientProvider locale="da" messages={da} timeZone="Europe/Copenhagen">
      <LogScreen {...base} {...props} />
    </NextIntlClientProvider>,
  );

const writes = () => fake.calls.filter((c) => c.method !== "GET");
const lookups = () => fake.calls.filter((c) => c.path.includes("/lookup")).map((c) => c.path);

beforeAll(() => {
  HTMLMediaElement.prototype.play = () => Promise.resolve();
});
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
});
afterEach(() => {
  cleanup();
  delete (navigator as { mediaDevices?: unknown }).mediaDevices;
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  nav.push.mockReset();
  live.state = null;
  live.handlers.clear();
});

async function typeAndSubmit(label: string, value: string) {
  const field = screen.getByRole("searchbox", { name: label });
  fireEvent.change(field, { target: { value } });
  fireEvent.keyDown(field, { key: "Enter" });
  await screen.findByTestId("lookup-results");
}

describe("Log-Telefon", () => {
  it("draws the header with a close, the two entry tiles, the search, favourites and recent", async () => {
    api({ favourites: [lunchbox, toast], recent: [apple] });
    mount();
    expect(screen.getByRole("heading", { name: "Log et måltid" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Scan" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Vælg" })).toBeVisible();
    expect(screen.queryByText("Sig det")).toBeNull();
    expect(screen.getByRole("searchbox", { name: "Skriv hvad der spises" })).toBeVisible();
    const favourites = await screen.findByRole("region", { name: "Favoritter" });
    expect(within(favourites).getByRole("link", { name: "Hele biblioteket" })).toHaveAttribute(
      "href",
      "/da/library",
    );
    expect(within(favourites).getByText("1 skive · 18 g")).toBeVisible();
    const recent = screen.getByRole("region", { name: "Spist for nylig" });
    expect(within(recent).getByRole("button", { name: "Æble · 14 g" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Luk" }));
    expect(nav.push).toHaveBeenCalledWith("/da/now");
  });

  it("hides favourites and recent while they are empty", async () => {
    api();
    mount();
    await waitFor(() => {
      expect(fake.calls.filter((c) => c.path.includes("/foods"))).toHaveLength(2);
    });
    expect(screen.queryByRole("region", { name: "Favoritter" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Spist for nylig" })).toBeNull();
  });

  it("looks up local sources as you type and every source on submit", async () => {
    api();
    mount();
    fireEvent.change(screen.getByRole("searchbox", { name: "Skriv hvad der spises" }), {
      target: { value: "rugbrød" },
    });
    await screen.findByTestId("lookup-results");
    expect(lookups()).toEqual(["/api/spaces/s1/lookup?q=rugbr%C3%B8d&remote=false"]);
    fireEvent.keyDown(screen.getByRole("searchbox", { name: "Skriv hvad der spises" }), {
      key: "Enter",
    });
    await waitFor(() => {
      expect(lookups()).toHaveLength(2);
    });
    expect(lookups()[1]).toBe("/api/spaces/s1/lookup?q=rugbr%C3%B8d&remote=true");
    expect(screen.getByText("egne retter først")).toBeVisible();
    expect(screen.getByRole("button", { name: /Opret "rugbrød" med dine egne tal/ })).toBeVisible();
  });

  it("shows a notice for a source that did not answer", async () => {
    api();
    fake.on("GET /api/spaces/s1/lookup", lookup({ sources: { off: "rate-limited" } }));
    mount();
    await typeAndSubmit("Skriv hvad der spises", "rugbrød");
    expect(screen.getByText("Open Food Facts svarer ikke lige nu")).toBeVisible();
  });

  it("picks a remote result into the library, asks how much and saves the meal to Now", async () => {
    api();
    mount();
    await typeAndSubmit("Skriv hvad der spises", "rugbrød");
    fireEvent.click(screen.getByRole("button", { name: "Rugbrød, Fiktivt Bageri" }));
    const confirm = await screen.findByTestId("log-confirm");
    expect(writes()[0]).toEqual({
      method: "POST",
      path: "/api/spaces/s1/foods",
      body: { candidate: offBread },
    });
    expect(within(confirm).getByRole("heading", { name: "Frokost" })).toBeVisible();
    expect(within(confirm).getByText("I dag 12:10")).toBeVisible();
    expect(within(confirm).getByRole("button", { name: "Annullér" })).toBeVisible();
    expect(within(confirm).getByRole("button", { name: "Tilbage" })).toBeVisible();
    expect(
      within(confirm).getByRole("heading", { name: "Hvor meget Rugbrød, Fiktivt Bageri?" }),
    ).toBeVisible();
    expect(within(confirm).getByText("40 g pr. 100 g")).toBeVisible();
    expect(within(confirm).getByText("Ikke tjekket")).toBeVisible();
    const save = within(confirm).getByRole("button", { name: "Gem måltid" });
    expect(save).toBeDisabled();
    fireEvent.click(within(confirm).getByRole("button", { name: "2 skiver · 36 g" }));
    expect(screen.getByTestId("total-bar")).toHaveTextContent("I alt36 g kulhydrat");
    expect(within(confirm).getByRole("button", { name: "Tag et billede" })).toBeVisible();
    fireEvent.click(save);
    await waitFor(() => {
      expect(nav.push).toHaveBeenCalledWith("/da/now");
    });
    expect(writes()[1]).toEqual({
      method: "POST",
      path: "/api/spaces/s1/meals",
      body: {
        items: [
          {
            foodId: "f-bread",
            name: "Rugbrød, Fiktivt Bageri",
            portionLabel: "2 skiver",
            carbs: 36,
          },
        ],
      },
    });
  });

  it("adds a library result without a write and weighs it", async () => {
    api();
    fake.on(
      "GET /api/spaces/s1/lookup",
      lookup({ results: [{ source: "library", verified: false, food: pickedBread }] }),
    );
    mount();
    await typeAndSubmit("Skriv hvad der spises", "rugbrød");
    fireEvent.click(screen.getByRole("button", { name: "Rugbrød, Fiktivt Bageri" }));
    await screen.findByTestId("log-confirm");
    fireEvent.click(screen.getByRole("button", { name: "Vej det" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Gram" }), { target: { value: "35" } });
    expect(screen.getByTestId("total-bar")).toHaveTextContent("14 g");
    expect(writes()).toEqual([]);
  });

  it("keeps the meal and says so when saving fails", async () => {
    api({ favourites: [lunchbox] });
    fake.on("POST /api/spaces/s1/meals", { error: { code: "internal", message: "x" } }, 500);
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /Min madpakke/ }));
    const confirm = await screen.findByTestId("log-confirm");
    fireEvent.click(within(confirm).getByRole("button", { name: "Gem måltid" }));
    expect(await screen.findByText("Måltidet blev ikke gemt – prøv igen")).toBeVisible();
    expect(within(confirm).getByText("Min madpakke")).toBeVisible();
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("taps the bolus as a time only and sends it with the meal", async () => {
    api({ favourites: [lunchbox] });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /Min madpakke/ }));
    await screen.findByTestId("log-confirm");
    fireEvent.click(screen.getByRole("button", { name: "Bolus givet nu" }));
    expect(screen.getByText("Bolus 12:10")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Fortryd" }));
    fireEvent.click(screen.getByRole("button", { name: "Bolus givet nu" }));
    fireEvent.click(screen.getByRole("button", { name: "Gem måltid" }));
    await waitFor(() => {
      expect(nav.push).toHaveBeenCalled();
    });
    expect(writes()[0]?.body).toEqual({
      items: [{ foodId: "f-box", name: "Min madpakke", portionLabel: "1 madpakke", carbs: 42 }],
      bolusTs: T0.toISOString(),
    });
  });

  it("has no bolus tap for a simpleMode session", async () => {
    api({ favourites: [lunchbox] });
    mount({ simpleMode: true });
    fireEvent.click(await screen.findByRole("button", { name: /Min madpakke/ }));
    await screen.findByTestId("log-confirm");
    expect(screen.queryByRole("button", { name: "Bolus givet nu" })).toBeNull();
    expect(screen.queryByText(/regner aldrig insulin/)).toBeNull();
  });

  it("shows the offline notice", () => {
    api();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    mount();
    expect(screen.getByText("Ingen forbindelse lige nu")).toBeVisible();
  });

  it("creates a manual food inline from Jeg kender tallet selv, unverified by the route", async () => {
    api();
    fake.on("POST /api/spaces/s1/foods", { ...pickedBread, id: "f-new", origin: "manual" }, 201);
    mount();
    await typeAndSubmit("Skriv hvad der spises", "rugbrød");
    fireEvent.click(screen.getByRole("button", { name: /Jeg kender tallet selv/ }));
    expect(screen.getByLabelText("Navn")).toHaveValue("rugbrød");
    fireEvent.change(screen.getByLabelText("Kulhydrat pr. 100 g"), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: "Opret og tilføj" }));
    await screen.findByTestId("log-confirm");
    expect(writes()[0]).toEqual({
      method: "POST",
      path: "/api/spaces/s1/foods",
      body: { from: "log", name: "rugbrød", carbsPer100g: 40, portions: [] },
    });
  });

  it("opens the library list from Vælg", async () => {
    api();
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Vælg" }));
    expect(await screen.findByRole("button", { name: "Æble" })).toBeVisible();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "aeble" } });
    expect(screen.queryByRole("button", { name: "Min madpakke" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Æble" }));
    expect(await screen.findByTestId("log-confirm")).toBeVisible();
  });
});

describe("scanning", () => {
  it("falls back to the typed field when the camera is denied, and validates the checksum first", async () => {
    api();
    stubMedia({
      getUserMedia: () => Promise.reject(new DOMException("denied", "NotAllowedError")),
    });
    fake.on(
      "GET /api/spaces/s1/lookup",
      lookup({ results: [], sources: { off: "ok" }, manual: { barcode: "2000000000015" } }),
    );
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Scan" }));
    expect(
      await screen.findByText("Kameraet kan ikke bruges lige nu. Skriv stregkoden i stedet."),
    ).toBeVisible();
    const field = screen.getByRole("searchbox", { name: "Stregkode" });
    fireEvent.change(field, { target: { value: "2000000000016" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(await screen.findByText("Tjek stregkoden og prøv igen.")).toBeVisible();
    expect(lookups()).toEqual([]);
    fireEvent.change(field, { target: { value: "2000000000015" } });
    fireEvent.keyDown(field, { key: "Enter" });
    // An unknown barcode never dead-ends: "Jeg kender tallet selv" with the barcode prefilled.
    expect(await screen.findByText("Stregkode 2000000000015")).toBeVisible();
    expect(lookups()).toEqual(["/api/spaces/s1/lookup?barcode=2000000000015"]);
  });

  it("looks up a scanned code and opens its portions", async () => {
    api();
    stubMedia({
      getUserMedia: () =>
        Promise.resolve({ getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream),
    });
    class FakeDetector {
      static getSupportedFormats = () => Promise.resolve(["ean_13"]);
      detect = () => Promise.resolve([{ rawValue: "2000000000015" }]);
    }
    vi.stubGlobal("BarcodeDetector", FakeDetector);
    fake.on(
      "GET /api/spaces/s1/lookup",
      lookup({ results: [{ source: "library", verified: false, food: pickedBread }] }),
    );
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Scan" }));
    expect(screen.getByRole("dialog", { name: "Scan en stregkode" })).toBeVisible();
    expect(
      await screen.findByRole(
        "heading",
        { name: "Hvor meget Rugbrød, Fiktivt Bageri?" },
        { timeout: 2000 },
      ),
    ).toBeVisible();
    expect(lookups()).toEqual(["/api/spaces/s1/lookup?barcode=2000000000015"]);
  });

  it("runs ?barcode= from the Now header on load", async () => {
    api();
    fake.on(
      "GET /api/spaces/s1/lookup",
      lookup({ results: [{ source: "library", verified: false, food: pickedBread }] }),
    );
    mount({ initialBarcode: "2000000000015" });
    expect(await screen.findByTestId("log-confirm")).toBeVisible();
  });
});

it("creates new meals only; edit and delete live in meal detail", async () => {
  api();
  mount();
  expect(await screen.findByTestId("log-phone")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Slet måltid" })).toBeNull();
  expect(fake.calls.some((call) => call.path.includes("meals/"))).toBe(false);
});

describe("Log-Desktop", () => {
  const reading: Reading = { ts: "2026-10-14T10:08:00.000Z", mmol: 6.4, trend: "flat" };
  beforeEach(() => {
    live.state = {
      loaded: true,
      connection: "live",
      lastSeq: 1,
      readings: [reading],
      latest: reading,
      sourceStatus: "connected",
      sourceSince: null,
      space: {
        glucoseUnit: "mmol",
        targetLow: 4,
        targetHigh: 10,
        timezone: "Europe/Copenhagen",
        sourceType: "dexcom-share",
      },
      error: null,
    };
  });

  it("draws the header with the live glucose value and its age", async () => {
    api({ favourites: [toast], recent: [apple] });
    mount({ layout: "desktop" });
    expect(screen.getByRole("heading", { name: "Log et måltid" })).toBeVisible();
    expect(screen.getByText("Onsdag 14. oktober · 12:10")).toBeVisible();
    const glucose = screen.getByTestId("log-glucose");
    expect(glucose).toHaveTextContent("6,4");
    expect(glucose).toHaveTextContent("for 2 min. siden");
    expect(
      screen.getByRole("searchbox", { name: "Søg mad eller skriv en stregkode" }),
    ).toBeVisible();
    expect(screen.getByText("Skriv, eller scan med en USB-scanner")).toBeVisible();
    expect(screen.queryByText("Sig det i stedet")).toBeNull();
    // The chips fill the results column before a query.
    expect(
      await within(screen.getByTestId("chip-foods")).findByText("Rugbrød med ost"),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Spist for nylig" }));
    expect(within(screen.getByTestId("chip-foods")).getByText("Æble")).toBeVisible();
    expect(screen.getByText("12:10 · logges af Jonas")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Frokost" })).toBeVisible();
  });

  it("never draws a glucose value before the feed has loaded", () => {
    api();
    if (!live.state) throw new Error("no state");
    live.state = { ...live.state, loaded: false };
    mount({ layout: "desktop" });
    expect(screen.queryByTestId("log-glucose")).toBeNull();
  });

  it("treats a typed EAN with a valid checksum plus Enter as a barcode", async () => {
    api();
    fake.on(
      "GET /api/spaces/s1/lookup",
      lookup({ results: [{ source: "library", verified: false, food: pickedBread }] }),
    );
    mount({ layout: "desktop" });
    const field = screen.getByRole("searchbox", { name: "Søg mad eller skriv en stregkode" });
    fireEvent.change(field, { target: { value: "2000000000015" } });
    fireEvent.keyDown(field, { key: "Enter" });
    const items = await screen.findByTestId("meal-items");
    expect(within(items).getByText("Rugbrød, Fiktivt Bageri")).toBeVisible();
    expect(lookups()).toEqual(["/api/spaces/s1/lookup?barcode=2000000000015"]);
    // Inline chips and a grams input on desktop.
    fireEvent.change(within(items).getByRole("spinbutton", { name: "Gram" }), {
      target: { value: "35" },
    });
    expect(screen.getByTestId("total-bar")).toHaveTextContent("14 g");
  });

  it("focuses with /, adds the highlighted result with Enter and saves with Ctrl+Enter", async () => {
    api();
    mount({ layout: "desktop" });
    const field = screen.getByRole("searchbox", { name: "Søg mad eller skriv en stregkode" });
    fireEvent.keyDown(document.body, { key: "/" });
    expect(field).toHaveFocus();
    await typeAndSubmit("Søg mad eller skriv en stregkode", "rugbrød");
    expect(screen.getByText("2 resultater · egne retter først · Enter tilføjer")).toBeVisible();
    fireEvent.keyDown(field, { key: "Enter" });
    const items = await screen.findByTestId("meal-items");
    expect(await within(items).findByText("Rugbrød med ost")).toBeVisible();
    expect(screen.getByTestId("total-bar")).toHaveTextContent("18 g");
    expect(screen.getByRole("button", { name: /Gem måltid/ })).toHaveTextContent("⌘↩");
    fireEvent.keyDown(field, { key: "Enter", ctrlKey: true });
    await waitFor(() => {
      expect(nav.push).toHaveBeenCalledWith("/da/now");
    });
    expect(writes()).toEqual([
      {
        method: "POST",
        path: "/api/spaces/s1/meals",
        body: {
          items: [
            { foodId: "f-toast", name: "Rugbrød med ost", portionLabel: "1 skive", carbs: 18 },
          ],
        },
      },
    ]);
  });

  it("moves the highlight with the arrows", async () => {
    api();
    mount({ layout: "desktop" });
    fireEvent.change(screen.getByRole("searchbox", { name: "Søg mad eller skriv en stregkode" }), {
      target: { value: "rugbrød" },
    });
    await screen.findByTestId("lookup-results");
    const field = screen.getByRole("searchbox", { name: "Søg mad eller skriv en stregkode" });
    fireEvent.keyDown(field, { key: "ArrowDown" });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => {
      expect(writes()[0]?.body).toEqual({ candidate: offBread });
    });
    await act(async () => {
      await Promise.resolve();
    });
  });

  it("never adds a stale highlighted row after the query changed", async () => {
    api();
    mount({ layout: "desktop" });
    const field = screen.getByRole("searchbox", { name: "Søg mad eller skriv en stregkode" });
    fireEvent.change(field, { target: { value: "rugbrød" } });
    await screen.findByTestId("lookup-results");
    fireEvent.keyDown(field, { key: "ArrowDown" });
    fireEvent.change(field, { target: { value: "æble" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => {
      expect(lookups().at(-1)).toBe("/api/spaces/s1/lookup?q=%C3%A6ble&remote=true");
    });
    expect(writes()).toEqual([]);
  });

  it("leaves the manual form with Annullér or by typing a new search", async () => {
    api();
    mount({ layout: "desktop" });
    await typeAndSubmit("Søg mad eller skriv en stregkode", "rugbrød");
    fireEvent.click(screen.getByRole("button", { name: /Jeg kender tallet selv/ }));
    fireEvent.click(screen.getByRole("button", { name: "Annullér" }));
    expect(screen.getByTestId("lookup-results")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /Jeg kender tallet selv/ }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Søg mad eller skriv en stregkode" }), {
      target: { value: "rugbrø" },
    });
    expect(screen.queryByRole("form", { name: "Jeg kender tallet selv" })).toBeNull();
  });

  it("runs ?q= from the Now header on load", async () => {
    api();
    mount({ layout: "desktop", initialQuery: "rugbrød" });
    await screen.findByTestId("lookup-results");
    expect(lookups()).toEqual(["/api/spaces/s1/lookup?q=rugbr%C3%B8d&remote=true"]);
  });
});

const enabledAi = {
  enabled: true,
  providers: [],
  callsToday: 0,
  dailyCap: 50,
  embedCallsToday: 0,
  embedDailyCap: 500,
};
describe("Say entry and confirmation", () => {
  beforeEach(() => {
    live.state = { loaded: false } as LiveState;
  });
  it.each(["phone", "desktop"] as const)(
    "opens Say on %s and saves candidates plus guesses through existing routes",
    async (layout) => {
      api()
        .on("GET /api/spaces/s1/ai", enabledAi)
        .on("POST /api/spaces/s1/parse", {
          items: [
            { query: "bread", match: { source: "off", food: offBread, portionLabel: "2 skiver" } },
            {
              query: "apple",
              estimate: { name: "Example apple", carbs: 14, confidence: "low", approx: true },
            },
          ],
          unmatched: [],
        });
      mount({ layout });
      fireEvent.click(
        await screen.findByRole("button", {
          name: layout === "phone" ? "Sig det" : "Sig det i stedet",
        }),
      );
      fireEvent.change(screen.getByLabelText("Skriv hvad der spises"), {
        target: { value: "bread and apple" },
      });
      expect(writes()).toEqual([]);
      fireEvent.click(screen.getByRole("button", { name: "Find maden" }));
      await screen.findByText("Example apple · ca. 14 g");
      fireEvent.click(screen.getByRole("button", { name: "Tilføj til måltidet" }));
      await waitFor(() => {
        expect(screen.queryByRole("button", { name: "Find maden" })).toBeNull();
      });
      expect(screen.getByText("Example apple · ca. 14 g")).toBeVisible();
      fireEvent.click(screen.getByRole("button", { name: /Gem måltid/ }));
      await waitFor(() => {
        expect(nav.push).toHaveBeenCalledWith("/da/now");
      });
      expect(writes().map((call) => call.path)).toEqual([
        "/api/spaces/s1/parse",
        "/api/spaces/s1/foods",
        "/api/spaces/s1/meals",
      ]);
      expect(writes().at(-1)?.body).toEqual({
        items: [
          { foodId: "f-bread", name: offBread.name, portionLabel: "2 skiver", carbs: 36 },
          { name: "Example apple", carbs: 14 },
        ],
      });
    },
  );
  it("keeps Say absent for simpleMode even if AI is enabled", async () => {
    api().on("GET /api/spaces/s1/ai", enabledAi);
    mount({ simpleMode: true });
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText("Sig det")).toBeNull();
    expect(fake.calls.some((call) => call.path.endsWith("/ai"))).toBe(false);
  });
});

it("attaches a confirmation photo without calling parse or estimates", async () => {
  api({ favourites: [toast] });
  mount();
  fireEvent.click(await screen.findByRole("button", { name: /Rugbrød med ost/ }));
  fireEvent.change(screen.getByLabelText("Tag et billede", { selector: "input" }), {
    target: {
      files: [new File([new Uint8Array([1, 2, 3])], "fictional.jpg", { type: "image/jpeg" })],
    },
  });
  await screen.findByTestId("meal-photo-preview");
  expect(writes()).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "1 skive · 18 g" }));
  fireEvent.click(screen.getByRole("button", { name: /Gem måltid/ }));
  await waitFor(() => {
    expect(writes()).toHaveLength(1);
  });
  expect(writes()[0]).toMatchObject({
    path: "/api/spaces/s1/meals",
    body: { photoDataUrl: "data:image/jpeg;base64,AQID" },
  });
});

it("keeps reviewed lines when choosing an unmatched food in search", async () => {
  api()
    .on("GET /api/spaces/s1/ai", enabledAi)
    .on("POST /api/spaces/s1/parse", {
      items: [
        {
          query: "apple",
          estimate: { name: "Example apple", carbs: 14, confidence: "low", approx: true },
        },
      ],
      unmatched: ["bread"],
    });
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Sig det" }));
  fireEvent.change(screen.getByLabelText("Skriv hvad der spises"), {
    target: { value: "apple and bread" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Find maden" }));
  await screen.findByText("Example apple · ca. 14 g");
  fireEvent.change(screen.getByLabelText("Kulhydrat (g)"), { target: { value: "16" } });
  fireEvent.click(screen.getByRole("button", { name: /Ikke fundet/ }));
  expect(screen.getByRole("searchbox")).toHaveValue("bread");
  fireEvent.click(screen.getByRole("button", { name: "Sig det" }));
  expect(screen.getByText("Example apple · ca. 16 g")).toBeVisible();
  expect(writes()).toHaveLength(1);
});

it("refreshes Say after a live AI setting change and closes it on opt-out", async () => {
  let enabled = false;
  api().on("GET /api/spaces/s1/ai", () => ({ ...enabledAi, enabled }));
  const mounted = mount();
  await waitFor(() => {
    expect(fake.calls.some((call) => call.path.endsWith("/ai"))).toBe(true);
  });
  expect(screen.queryByRole("button", { name: "Sig det" })).toBeNull();
  enabled = true;
  act(() => {
    live.handlers.get("space.updated")?.();
  });
  fireEvent.click(await screen.findByRole("button", { name: "Sig det" }));
  expect(screen.getByRole("button", { name: "Find maden" })).toBeVisible();
  enabled = false;
  act(() => {
    live.handlers.get("space.updated")?.();
  });
  await waitFor(() => {
    expect(screen.queryByRole("button", { name: "Find maden" })).toBeNull();
  });
  expect(screen.queryByRole("button", { name: "Sig det" })).toBeNull();
  expect(writes()).toEqual([]);
  mounted.unmount();
  expect(live.handlers.has("space.updated")).toBe(false);
});

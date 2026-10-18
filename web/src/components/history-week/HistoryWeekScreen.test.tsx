import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WeekHistoryView } from "@frejsi/shared/schemas/history";
import { getMessages } from "@/lib/i18n/messages";
import fixture from "./fixtures/week.json";
import { HistoryWeekScreen } from "./HistoryWeekScreen";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  loaded: true,
  handlers: new Map<string, () => void>(),
  subscribe: (type: string, handler: () => void) => {
    mocks.handlers.set(type, handler);
    return () => {
      mocks.handlers.delete(type);
    };
  },
  error: null as string | null,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));
vi.mock("@/lib/live/useLiveFeed", () => ({
  useLiveFeed: (_id: string, options: { readings?: boolean }) => {
    expect(options.readings).toBe(false);
    return { loaded: mocks.loaded, subscribe: mocks.subscribe, error: mocks.error };
  },
}));
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected fixture row");
  return value;
}
const initial = WeekHistoryView.parse(fixture);
let data: WeekHistoryView;
let request: ReturnType<typeof vi.fn<typeof fetch>>;
function mount(
  view: "uge" | "maaltider" = "uge",
  start = data.weekStart,
  locale: "da" | "en" = "da",
) {
  return render(
    <NextIntlClientProvider locale={locale} messages={getMessages(locale)}>
      <HistoryWeekScreen
        spaceId="s1"
        locale={locale}
        unit="mmol"
        start={start}
        view={view}
        fetch={request}
      />
    </NextIntlClientProvider>,
  );
}
beforeEach(() => {
  data = structuredClone(initial);
  mocks.error = null;
  mocks.loaded = true;
  mocks.refresh.mockClear();
  request = vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify(data))));
  mocks.push.mockClear();
});
afterEach(() => {
  cleanup();
  mocks.handlers.clear();
});
it("loads only the week route once, showing seven day links, real charts and weekly statistics", async () => {
  mount();
  expect(await screen.findByRole("heading", { name: "Historik", level: 1 })).toBeVisible();
  expect(screen.getByRole("heading", { name: "Uge 41", level: 2 })).toBeVisible();
  expect(screen.getByText("6.–12. oktober")).toBeVisible();
  const days = screen.getByRole("region", { name: "Ugens dage" });
  expect(within(days).getAllByRole("link")).toHaveLength(7);
  expect(within(days).getAllByRole("img")).toHaveLength(7);
  expect(within(days).getAllByRole("link")[0]).toHaveAttribute(
    "href",
    "/da/history?date=2025-10-06",
  );
  expect(days.querySelectorAll('[data-variant="week-tile"]')).toHaveLength(7);
  expect(screen.getByText("81 %")).toBeVisible();
  expect(screen.getByText("sidste uge 76 %")).toBeVisible();
  expect(screen.getByText("3 gange, alle om natten")).toBeVisible();
  expect(screen.getByText("116 g")).toBeVisible();
  expect(screen.getByText("i gennemsnit, 17 af 23 registreret")).toBeVisible();
  expect(screen.getByText(/Tallene er regnet direkte/)).toBeVisible();
  expect(screen.queryByText(/Spørgsmål til klinikken|Gem som PDF|Ugens opsummering/)).toBeNull();
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0]?.[0]).toBe("/api/spaces/s1/history/week?start=2025-10-06");
  expect(screen.getByRole("radio", { name: "Dag" })).toHaveAttribute(
    "href",
    "/da/history?date=2025-10-06",
  );
  expect(screen.getByRole("radio", { name: "Måltider" })).toHaveAttribute(
    "href",
    expect.stringContaining("view=maaltider"),
  );
});
it("keeps a phone Day link and accessible previous/next links and shortcuts", async () => {
  mount();
  const previous = await screen.findByRole("link", { name: "Forrige uge" });
  expect(previous).toHaveAttribute("href", "/da/history/week?start=2025-09-29&view=uge");
  expect(screen.getByRole("link", { name: "Dag" })).toHaveAttribute("href", "/da/history");
  // The shortcuts wait for the week's data; the link above renders before it arrives.
  await screen.findByText("i gennemsnit, 17 af 23 registreret");
  fireEvent.keyDown(document.body, { key: "ArrowLeft" });
  expect(mocks.push).toHaveBeenLastCalledWith(previous.getAttribute("href"));
  fireEvent.keyDown(screen.getByRole("radio", { name: "Uge" }), { key: "ArrowRight" });
  expect(mocks.push).toHaveBeenCalledTimes(1);
});
it("disables next in the current week and sends Day to today in the space timezone", async () => {
  data.now = "2025-10-08T22:30:00Z";
  mount();
  expect(await screen.findByRole("button", { name: "Næste uge" })).toBeDisabled();
  expect(screen.getByRole("radio", { name: "Dag" })).toHaveAttribute(
    "href",
    "/da/history?date=2025-10-09",
  );
  fireEvent.keyDown(document.body, { key: "ArrowRight" });
  expect(mocks.push).not.toHaveBeenCalled();
});
it("renders meals newest first, keeps a peak timestamp, and reuses row keyboard navigation", async () => {
  mount("maaltider");
  const table = await screen.findByRole("table");
  const rows = within(table).getAllByRole("row").slice(1);
  expect(rows).toHaveLength(2);
  expect(rows[0]).toHaveTextContent("12:10");
  expect(within(required(rows[0])).getByRole("img", { name: "Top 9,6 kl. 13:15" })).toBeVisible();
  act(() => {
    required(rows[0]).focus();
  });
  fireEvent.keyDown(required(rows[0]), { key: "j" });
  expect(rows[1]).toHaveFocus();
  fireEvent.keyDown(required(rows[1]), { key: "k" });
  expect(rows[0]).toHaveFocus();
  fireEvent.keyDown(required(rows[0]), { key: "ArrowDown" });
  fireEvent.keyDown(required(rows[1]), { key: "Enter" });
  expect(mocks.push).toHaveBeenLastCalledWith("/da/meal/meal-older");
});
it("shows seven zero-meal tiles and four missing weekly values even with sensor data", async () => {
  data.meals = [];
  data.numbers.mealCount = 0;
  data.days = data.days.map((day) => ({ ...day, mealCount: 0, totalCarbs: 0, mealTimes: [] }));
  mount("maaltider");
  expect(await screen.findAllByText("0 måltider")).toHaveLength(7);
  const numbers = screen.getByRole("region", { name: "Ugens tal" });
  expect(within(numbers).getAllByText("–")).toHaveLength(4);
});
it("refreshes the current week on each meal event but leaves historical weeks alone", async () => {
  data.now = "2025-10-08T12:00:00Z";
  mount();
  await screen.findByText("81 %");
  for (const type of ["meal.created", "meal.updated", "meal.deleted"]) {
    data.numbers.inRangePercent = (data.numbers.inRangePercent ?? 0) - 1;
    act(() => {
      mocks.handlers.get(type)?.();
    });
    await screen.findByText(`${data.numbers.inRangePercent} %`);
  }
  expect(request).toHaveBeenCalledTimes(4);
  cleanup();
  data.now = initial.now;
  request.mockClear();
  mount();
  await screen.findByText("78 %");
  act(() => {
    mocks.handlers.get("meal.created")?.();
  });
  expect(request).toHaveBeenCalledTimes(1);
});
it("reads the week again on pump.meals, an old week too, and never asks for the pump record (v0.7.0 plan §6)", async () => {
  const global: string[] = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    global.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    return Promise.resolve(Response.json({ symptoms: [], kinds: [] }));
  });
  try {
    for (const now of ["2025-10-08T12:00:00Z", initial.now]) {
      cleanup();
      request.mockClear();
      data.now = now;
      mount();
      await screen.findByText(`${String(data.numbers.inRangePercent)} %`);
      data.numbers.inRangePercent = (data.numbers.inRangePercent ?? 0) - 1;
      act(() => {
        mocks.handlers.get("pump.meals")?.();
      });
      await screen.findByText(`${String(data.numbers.inRangePercent)} %`);
      expect(request).toHaveBeenCalledTimes(2);
    }
    // The week's mini curves draw no pump markers, so nothing reads the pump record.
    expect(mocks.handlers.has("pump.imported")).toBe(false);
    expect(
      [
        ...global,
        ...request.mock.calls.map(([url]) =>
          typeof url === "string" ? url : url instanceof URL ? url.href : url.url,
        ),
      ].some((url) => url.includes("/pump")),
    ).toBe(false);
    expect(document.querySelector("[data-testid^=pump]")).toBeNull();
  } finally {
    vi.unstubAllGlobals();
  }
});
it("does not refetch when switching view for the same week", async () => {
  const tree = mount();
  await screen.findByText("81 %");
  tree.rerender(
    <NextIntlClientProvider locale="da" messages={getMessages("da")}>
      <HistoryWeekScreen
        spaceId="s1"
        locale="da"
        unit="mmol"
        start={data.weekStart}
        view="maaltider"
        fetch={request}
      />
    </NextIntlClientProvider>,
  );
  await screen.findByRole("table");
  expect(request).toHaveBeenCalledTimes(1);
});
it("discards stale responses and clears protected content on refusal", async () => {
  const tree = mount();
  await screen.findByText("81 %");
  request.mockImplementation(() => Promise.resolve(new Response("{}", { status: 403 })));
  tree.rerender(
    <NextIntlClientProvider locale="da" messages={getMessages("da")}>
      <HistoryWeekScreen
        spaceId="s1"
        locale="da"
        unit="mmol"
        start="2025-09-29"
        view="uge"
        fetch={request}
      />
    </NextIntlClientProvider>,
  );
  expect(screen.queryByText("81 %")).toBeNull();
  await screen.findByRole("alert");
  expect(screen.queryByRole("img")).toBeNull();
});
it("offers retry after a failed request and renders English copy", async () => {
  request.mockRejectedValueOnce(new Error("offline"));
  mount("uge", data.weekStart, "en");
  fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
  await screen.findByRole("heading", { name: "History" });
  expect(screen.getByText("Weekly numbers")).toBeVisible();
  await waitFor(() => {
    expect(request).toHaveBeenCalledTimes(2);
  });
});
it("ignores an old week's delayed response after navigation", async () => {
  let finishOld: (response: Response) => void = () => undefined;
  request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishOld = resolve;
      }),
  );
  const tree = mount();
  const newer = {
    ...data,
    weekStart: "2025-10-13",
    weekEnd: "2025-10-19",
    isoWeek: 42,
    numbers: { ...data.numbers, inRangePercent: 77 },
  };
  request.mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify(newer))));
  tree.rerender(
    <NextIntlClientProvider locale="da" messages={getMessages("da")}>
      <HistoryWeekScreen
        spaceId="s1"
        locale="da"
        unit="mmol"
        start="2025-10-13"
        view="uge"
        fetch={request}
      />
    </NextIntlClientProvider>,
  );
  await screen.findByText("77 %");
  await act(async () => {
    finishOld(new Response(JSON.stringify(data)));
    await Promise.resolve();
  });
  expect(screen.getByText("77 %")).toBeVisible();
  expect(screen.queryByText("81 %")).toBeNull();
});
it("says '< 1 %' below the target when there were episodes but the share rounds to 0", async () => {
  data.numbers.belowPercent = 0;
  data.numbers.lowEpisodes = { count: 5, atNight: 2 };
  mount();
  expect(await screen.findByText("5 gange, 2 om natten")).toBeVisible();
  expect(screen.getByText("< 1 %")).toBeVisible();
  expect(screen.queryByText("0 %")).toBeNull();
});
it("keeps '0 %' below the target when there were no episodes at all", async () => {
  data.numbers.belowPercent = 0;
  data.numbers.lowEpisodes = { count: 0, atNight: 0 };
  mount();
  expect(await screen.findByText("ingen")).toBeVisible();
  expect(screen.getByText("0 %")).toBeVisible();
});
it("draws the phone header like the day view: title with the Day link, the week between the arrows", async () => {
  mount();
  expect(await screen.findByRole("heading", { name: "Historik", level: 1 })).toBeVisible();
  const week = screen.getByRole("heading", { name: "Uge 41", level: 2 });
  const period = week.closest("header");
  expect(period).not.toBeNull();
  if (!period) return;
  expect(within(period).getByText("6.–12. oktober")).toBeVisible();
  expect(within(period).getByRole("link", { name: "Forrige uge" })).toHaveAttribute(
    "href",
    "/da/history/week?start=2025-09-29&view=uge",
  );
  expect(within(period).getByRole("link", { name: "Næste uge" })).toHaveAttribute(
    "href",
    "/da/history/week?start=2025-10-13&view=uge",
  );
  // The phone tiles stretch to the card: a wide viewBox drawn without letterboxing.
  const tile = screen.getByRole("region", { name: "Ugens dage" }).querySelector("svg");
  expect(tile).toHaveAttribute("viewBox", "0 0 320 64");
  expect(tile).toHaveAttribute("preserveAspectRatio", "none");
});
it("keeps Historik-Desktop from 1280 px: subtitle under the title, chips and arrows in the toolbar", async () => {
  vi.stubGlobal("matchMedia", (query: string): MediaQueryList => ({
    matches: query === "(min-width: 1280px)",
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }));
  try {
    mount();
    expect(await screen.findByText("Uge 41 · 6.–12. oktober")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Uge 41", level: 2 })).toBeNull();
    expect(screen.queryByRole("link", { name: "Dag" })).toBeNull();
    expect(screen.getByRole("radio", { name: "Dag" })).toHaveAttribute(
      "href",
      "/da/history?date=2025-10-06",
    );
    expect(screen.getByRole("link", { name: "Forrige uge" })).toHaveAttribute(
      "href",
      "/da/history/week?start=2025-09-29&view=uge",
    );
    const tile = screen.getByRole("region", { name: "Ugens dage" }).querySelector("svg");
    expect(tile).toHaveAttribute("viewBox", "0 0 120 64");
  } finally {
    vi.unstubAllGlobals();
  }
});
it("shows partial night episode counts and an after-meal mean without advice", async () => {
  data.numbers.lowEpisodes.atNight = 1;
  data.numbers.bolusLead.meanMinutes = -5;
  mount();
  expect(await screen.findByText("3 gange, 1 om natten")).toBeVisible();
  expect(screen.getByText("5 min efter måltidet")).toBeVisible();
});
// Issue #215: the bolus figure and column show only when a meal in the week has a stored time.
describe("bolus lead on the week (issue #215)", () => {
  const withoutBolus = () => {
    data.numbers.bolusLead = { registered: 0, of: data.numbers.bolusLead.of };
    data.meals = data.meals.map(
      ({ bolusLeadMinutes: _row, stats: { bolusLeadMinutes: _stats, ...stats }, ...meal }) => ({
        ...meal,
        stats,
      }),
    );
  };

  it("shows the bolus figure and column when a meal in the week has a stored time", async () => {
    mount();
    const numbers = await screen.findByRole("region", { name: "Ugens tal" });
    expect(within(numbers).getByText("Bolus før måltid")).toBeVisible();
    expect(within(numbers).getByText("9 min")).toBeVisible();
    cleanup();
    mount("maaltider");
    const table = await screen.findByRole("table");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((h) => h.textContent),
    ).toEqual(["Dato", "Kulhydrat", "Bolus før", "Top", "I mål af 3 t"]);
  });

  it("leaves out the bolus figure and column when no meal in the week has one", async () => {
    withoutBolus();
    mount();
    const numbers = await screen.findByRole("region", { name: "Ugens tal" });
    expect(within(numbers).getByText("116 g")).toBeVisible();
    expect(numbers.querySelectorAll('[data-part="label"]')).toHaveLength(3);
    expect(numbers.textContent).not.toMatch(/bolus|registreret/i);
    cleanup();
    mount("maaltider");
    const table = await screen.findByRole("table");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((h) => h.textContent),
    ).toEqual(["Dato", "Kulhydrat", "Top", "I mål af 3 t"]);
    expect(table.textContent).not.toMatch(/bolus/i);
  });
});
it.each(["member.updated", "member.removed"])(
  "clears a historical week and reauthorizes on %s",
  async (type) => {
    mount("maaltider");
    await screen.findByRole("table");
    request.mockImplementationOnce(() => Promise.resolve(new Response("{}", { status: 403 })));
    act(() => {
      mocks.handlers.get(type)?.();
    });
    expect(screen.queryByRole("table")).toBeNull();
    await screen.findByRole("alert");
    expect(request).toHaveBeenCalledTimes(2);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("img")).toBeNull();
  },
);
it("establishes the event cursor before the first week snapshot", async () => {
  mocks.loaded = false;
  const tree = mount();
  expect(request).not.toHaveBeenCalled();
  data.numbers.inRangePercent = 73;
  mocks.loaded = true;
  tree.rerender(
    <NextIntlClientProvider locale="da" messages={getMessages("da")}>
      <HistoryWeekScreen
        spaceId="s1"
        locale="da"
        unit="mmol"
        start={data.weekStart}
        view="uge"
        fetch={request}
      />
    </NextIntlClientProvider>,
  );
  await screen.findByText("73 %");
  expect(request).toHaveBeenCalledTimes(1);
});
it("reloads targets and server display preferences on a space change", async () => {
  const tree = mount("maaltider");
  await screen.findByRole("table");
  data.target = { low: 5, high: 9 };
  data.numbers.inRangePercent = 72;
  act(() => {
    mocks.handlers.get("space.updated")?.();
  });
  expect(screen.queryByRole("table")).toBeNull();
  expect(mocks.refresh).toHaveBeenCalledTimes(1);
  tree.rerender(
    <NextIntlClientProvider locale="da" messages={getMessages("da")}>
      <HistoryWeekScreen
        spaceId="s1"
        locale="da"
        unit="mgdl"
        start={data.weekStart}
        view="maaltider"
        fetch={request}
      />
    </NextIntlClientProvider>,
  );
  await screen.findByText("I mål 90–162");
  expect(screen.getByText("72 %")).toBeVisible();
  expect(screen.getAllByRole("img", { name: /Top 173 kl. 13:15/ })).toHaveLength(2);
  expect(request).toHaveBeenCalledTimes(2);
});

it("draws a day's meals as their food symbols at 8 px, and the dots where a tile has none", async () => {
  const monday = data.days[0];
  if (!monday) throw new Error("fixture");
  monday.meals = [{ ts: "2025-10-06T10:10:00Z", symbol: "bread" }];
  mount();
  const days = await screen.findByRole("region", { name: "Ugens dage" });
  const tiles = days.querySelectorAll('[data-variant="week-tile"]');
  const first = tiles[0];
  if (!first) throw new Error("tile");
  const symbol = first.querySelector("svg[data-testid=food-symbol]");
  expect(symbol).toHaveAttribute("data-symbol", "bread");
  expect(symbol).toHaveAttribute("width", "8");
  expect(first.querySelector("[data-testid=meal-dot]")).toBeNull();
  expect(tiles[1]?.querySelector("[data-testid=meal-dot]")).not.toBeNull();
});

describe("symptoms on the week (v0.6.0 plan §5)", () => {
  const symptom = {
    id: "s1",
    kind: "stomach-ache",
    ts: "2025-10-07T10:00:00.000Z", // Tuesday 12:00 Copenhagen
    byUserId: "u1",
    byName: "Jonas",
  };
  let symptoms: (typeof symptom)[];
  let symptomCalls: string[];
  beforeEach(() => {
    symptoms = [symptom];
    symptomCalls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string) => {
        const url = new URL(input, "https://frejsi.example");
        symptomCalls.push(`${url.pathname}${url.search}`);
        if (url.pathname.endsWith("/symptoms/kinds"))
          return Promise.resolve(Response.json({ kinds: [] }));
        return Promise.resolve(Response.json({ symptoms }));
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the seven days once, draws the diamond on its tile and opens the detail without readings", async () => {
    mount();
    const target = await screen.findByRole("button", { name: "Ondt i maven kl. 12:00" });
    expect(symptomCalls.filter((c) => c.includes("/symptoms?"))).toEqual([
      "/api/spaces/s1/symptoms?from=2025-10-05T22%3A00%3A00.000Z&to=2025-10-12T21%3A59%3A59.999Z",
    ]);
    const days = screen.getByRole("region", { name: "Ugens dage" });
    const tiles = days.querySelectorAll('[data-variant="week-tile"]');
    expect(tiles[1]?.querySelector("[data-testid=symptom-marker]")).not.toBeNull();
    expect(tiles[0]?.querySelector("[data-testid=symptom-marker]")).toBeNull();
    // The tile is still one link to its day, and the tap target is not inside it.
    expect(within(days).getAllByRole("link")).toHaveLength(7);
    expect(target.closest("a")).toBeNull();
    fireEvent.click(target);
    const dialog = screen.getByRole("dialog", { name: "Ondt i maven kl. 12:00" });
    expect(dialog).toHaveTextContent("Logget af Jonas");
    // The week has bucket averages, not readings: none are shown as if they were.
    expect(within(dialog).queryByRole("list")).toBeNull();
    act(() => {
      mocks.handlers.get("symptom.deleted")?.();
    });
    await waitFor(() => {
      expect(symptomCalls.filter((c) => c.includes("/symptoms?"))).toHaveLength(2);
    });
  });

  it("filters the tiles to the days with symptoms from the period header, and says when there are none", async () => {
    mount();
    await screen.findByRole("button", { name: "Ondt i maven kl. 12:00" });
    const chip = screen.getByRole("button", { name: "Symptomer" });
    expect(chip.closest("header")).not.toBeNull();
    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "true");
    const days = screen.getByRole("region", { name: "Ugens dage" });
    expect(within(days).getAllByRole("link")).toHaveLength(1);
    expect(within(days).getByRole("link")).toHaveAttribute("href", "/da/history?date=2025-10-07");
    cleanup();
    symptoms = [];
    mount();
    await screen.findByRole("region", { name: "Ugens dage" });
    await waitFor(() => {
      expect(symptomCalls.filter((c) => c.includes("/symptoms?"))).toHaveLength(2);
    });
    fireEvent.click(screen.getByRole("button", { name: "Symptomer" }));
    expect(await screen.findByText("Ingen symptomer denne uge")).toBeVisible();
  });
});

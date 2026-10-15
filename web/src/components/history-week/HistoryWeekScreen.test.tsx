import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WeekHistoryView } from "@frejsi/shared/schemas/history";
import { getMessages } from "@/lib/i18n/messages";
import fixture from "./fixtures/week.json";
import { HistoryWeekScreen } from "./HistoryWeekScreen";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  handlers: new Map<string, () => void>(),
  subscribe: (type: string, handler: () => void) => {
    mocks.handlers.set(type, handler);
    return () => {
      mocks.handlers.delete(type);
    };
  },
  error: null as string | null,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/lib/live/useLiveFeed", () => ({
  useLiveFeed: (_id: string, options: { readings?: boolean }) => {
    expect(options.readings).toBe(false);
    return { subscribe: mocks.subscribe, error: mocks.error };
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
  expect(screen.getByText(/Uge 41 · 6\.–12\. oktober/)).toBeVisible();
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
it("shows partial night episode counts and an after-meal mean without advice", async () => {
  data.numbers.lowEpisodes.atNight = 1;
  data.numbers.bolusLead.meanMinutes = -5;
  mount();
  expect(await screen.findByText("3 gange, 1 om natten")).toBeVisible();
  expect(screen.getByText("5 min efter måltidet")).toBeVisible();
});

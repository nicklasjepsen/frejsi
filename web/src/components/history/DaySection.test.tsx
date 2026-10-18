import "@testing-library/jest-dom/vitest";

import type { DayHistoryView } from "@frejsi/shared/schemas/history";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import da from "../../../messages/da";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

import { DaySection } from "./DaySection";

const NOW = new Date("2026-10-14T11:20:00.000Z");
const TODAY = "2026-10-14";
const range = {
  minutes: 530,
  coveredMinutes: 553,
  windowMinutes: 1440,
  complete: false,
  belowMinutes: 23,
  aboveMinutes: 0,
};
const stats = {
  peak: { mmol: 9.6, ts: "2026-10-14T11:15:00.000Z", minutesAfterMeal: 65 },
  inRange: range,
  readingCount: 1,
};
const day: DayHistoryView = {
  date: TODAY,
  timezone: "Europe/Copenhagen",
  from: "2026-10-13T22:00:00.000Z",
  to: "2026-10-14T22:00:00.000Z",
  target: { low: 4, high: 10 },
  readings: [{ ts: "2026-10-14T11:15:00.000Z", mmol: 9.6, trend: "flat" }],
  inRange: range,
  totalCarbs: 64,
  mealCount: 2,
  meals: [
    {
      id: "m1",
      ts: "2026-10-14T10:10:00.000Z",
      title: "Rugbrød med ost og et æble",
      slot: "lunch",
      totalCarbs: 50,
      byUser: { id: "u1", name: "Jonas" },
      items: [{ name: "Apple", carbs: 50 }],
      stats,
    },
    {
      id: "m2",
      ts: "2026-10-14T06:30:00.000Z",
      title: "Havregryn",
      slot: "breakfast",
      totalCarbs: 14,
      byUser: { id: "u2", name: "Mette" },
      items: [{ name: "Havregryn", carbs: 14 }],
      stats: { ...stats, peak: undefined },
    },
  ],
  hasOlder: true,
  now: NOW.toISOString(),
};

function mount(props: Partial<Parameters<typeof DaySection>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="da" messages={da}>
      <DaySection
        spaceId="s1"
        day={day}
        today={TODAY}
        locale="da"
        unit="mmol"
        desktop={false}
        liveReadings={[]}
        onNavigate={vi.fn()}
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  push.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("DaySection rows (the owner's and the carer's day)", () => {
  it("links each row to its meal from inside the card and trails a 'Ret' to ?edit=1", () => {
    mount();
    const [first, second] = screen.getAllByTestId("meal-card");
    expect(screen.getAllByTestId("meal-card")).toHaveLength(2);
    if (!first || !second) throw new Error("two rows expected");
    const link = within(first).getByRole("link", { name: /Rugbrød/ });
    expect(link).toHaveAttribute("href", "/da/meal/m1");
    expect(link).toHaveTextContent("50 g · top 9,6 efter 1 t 05 · Jonas");
    expect(within(first).getByTestId("meal-edit")).toHaveAttribute("href", "/da/meal/m1?edit=1");
    expect(within(second).getByTestId("meal-edit")).toHaveAttribute("href", "/da/meal/m2?edit=1");
    // The list item owns the card: no link wraps the article any more.
    expect(first.closest("a")).toBeNull();
  });

  it("passes the role through: a carer edits too", () => {
    mount({ role: "carer" });
    expect(screen.getAllByTestId("meal-edit")).toHaveLength(2);
  });

  it("still moves between the rows' links with the arrow keys", () => {
    mount();
    const first = screen.getByRole("link", { name: /Rugbrød/ });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(screen.getByRole("link", { name: /Havregryn/ })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("link", { name: /Havregryn/ }), { key: "ArrowDown" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "ArrowUp" });
    expect(screen.getByRole("link", { name: /Havregryn/ })).toHaveFocus();
  });
});

describe("the food symbol on the day curve (v0.6.0 plan §7)", () => {
  it("passes each meal's symbol to the curve and names the tap target with its category", () => {
    const first = day.meals[0];
    if (!first) throw new Error("fixture");
    mount({ day: { ...day, meals: [{ ...first, symbol: "bread" }, ...day.meals.slice(1)] } });
    expect(
      document.querySelector("svg[data-testid=food-symbol][data-symbol=bread]"),
    ).not.toBeNull();
    expect(screen.getByRole("button", { name: "Måltid, Brød, kl. 12:10" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Måltid kl. 08:30" })).toBeInTheDocument();
  });
});

describe("symptoms on the day (v0.6.0 plan §5)", () => {
  const symptom = {
    id: "s1",
    kind: "stomach-ache",
    ts: "2026-10-14T11:00:00.000Z", // 13:00, between the two meals, 15 min before the reading and before now
    severity: "light" as const,
    byUserId: "u1",
    byName: "Jonas",
  };
  let symptoms: (typeof symptom)[];
  let fetchCalls: string[];
  beforeEach(() => {
    symptoms = [symptom];
    fetchCalls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string) => {
        const url = new URL(input, "https://frejsi.example");
        fetchCalls.push(`${url.pathname}${url.search}`);
        if (url.pathname.endsWith("/symptoms/kinds"))
          return Promise.resolve(Response.json({ kinds: [] }));
        return Promise.resolve(Response.json({ symptoms }));
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the day's symptoms once, draws the diamond with its tap target and a row in the list", async () => {
    mount();
    const target = await screen.findByRole("button", { name: "Ondt i maven kl. 13:00" });
    expect(target).toBeInTheDocument();
    expect(fetchCalls.filter((c) => c.includes("/symptoms?"))).toEqual([
      // The route includes both ends: the day stops a millisecond before the next midnight.
      "/api/spaces/s1/symptoms?from=2026-10-13T22%3A00%3A00.000Z&to=2026-10-14T21%3A59%3A59.999Z",
    ]);
    expect(document.querySelectorAll("svg [data-testid=symptom-marker]")).toHaveLength(1);
    // The row sits between the meals by time: 12:10, 13:30, 08:30 newest first → m1, s1, m2.
    const list = screen.getByRole("list", { name: "Måltider" });
    const rows = within(list).getAllByRole("listitem");
    expect(
      rows.map((row) => row.querySelector("[data-testid]")?.getAttribute("data-testid")),
    ).toEqual(["symptom-row", "meal-card", "meal-card"]);
    expect(
      screen.getByRole("button", { name: "Ondt i maven kl. 13:00 · Jonas" }),
    ).toBeInTheDocument();
  });

  it("deletes from the card for an owner or carer, and the marker and row leave on symptom.deleted (issue 220)", async () => {
    const handlers = new Map<string, () => void>();
    const subscribe = (type: string, handler: () => void) => {
      handlers.set(type, handler);
      return () => handlers.delete(type);
    };
    mount({ role: "carer", subscribe });
    fireEvent.click(await screen.findByRole("button", { name: "Ondt i maven kl. 13:00" }));
    const dialog = screen.getByRole("dialog", { name: "Ondt i maven kl. 13:00" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Slet" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Slet" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(fetchCalls).toContain("/api/spaces/s1/symptoms/s1");
    symptoms = [];
    act(() => {
      handlers.get("symptom.deleted")?.();
    });
    await waitFor(() => {
      expect(document.querySelectorAll("svg [data-testid=symptom-marker]")).toHaveLength(0);
    });
    expect(screen.queryByTestId("symptom-row")).toBeNull();
  });

  it("offers no 'Slet' in simpleMode", async () => {
    mount({ simpleMode: true });
    fireEvent.click(await screen.findByRole("button", { name: "Ondt i maven kl. 13:00" }));
    const dialog = screen.getByRole("dialog", { name: "Ondt i maven kl. 13:00" });
    expect(within(dialog).queryByRole("button", { name: "Slet" })).toBeNull();
  });

  it("opens the detail on tap with the readings from −30 to +30 min and their times, and closes it", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Ondt i maven kl. 13:00" }));
    const dialog = screen.getByRole("dialog", { name: "Ondt i maven kl. 13:00" });
    expect(dialog).toHaveTextContent("Lidt");
    expect(dialog).toHaveTextContent("Logget af Jonas");
    // Each value with its time and its age (the reading is 5 minutes before the test's now).
    expect(within(dialog).getByRole("list", { name: "Tal omkring" })).toHaveTextContent(
      "13:15 · 9,6 mmol/L · for 5 min. siden",
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Luk" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    // The row opens the same detail.
    fireEvent.click(screen.getByRole("button", { name: "Ondt i maven kl. 13:00 · Jonas" }));
    expect(screen.getByRole("dialog", { name: "Ondt i maven kl. 13:00" })).toBeInTheDocument();
  });

  it("with the Symptomer filter shows the symptom rows only, and says so when there are none", async () => {
    mount({ symptomsOnly: true });
    await screen.findByTestId("symptom-row");
    expect(screen.queryByTestId("meal-card")).toBeNull();
    cleanup();
    symptoms = [];
    mount({ symptomsOnly: true });
    expect(await screen.findByText("Ingen symptomer denne dag")).toBeVisible();
    expect(screen.queryByTestId("meal-card")).toBeNull();
  });

  it("says that the symptoms could not be loaded, with a retry, never that there are none", async () => {
    let fail = true;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string) => {
        const url = new URL(input, "https://frejsi.example");
        if (url.pathname.endsWith("/symptoms/kinds"))
          return Promise.resolve(Response.json({ kinds: [] }));
        if (fail) return Promise.resolve(new Response("down", { status: 500 }));
        return Promise.resolve(Response.json({ symptoms }));
      }),
    );
    mount({ symptomsOnly: true });
    const failed = await screen.findByTestId("symptoms-failed");
    expect(failed).toHaveTextContent("Symptomerne kunne ikke hentes lige nu.");
    expect(screen.queryByText("Ingen symptomer denne dag")).toBeNull();
    fail = false;
    fireEvent.click(within(failed).getByRole("button", { name: "Prøv igen" }));
    expect(await screen.findByTestId("symptom-row")).toBeVisible();
    expect(screen.queryByTestId("symptoms-failed")).toBeNull();
  });

  it("moves between meal links and symptom buttons with the arrow keys", async () => {
    mount();
    const row = await screen.findByRole("button", { name: "Ondt i maven kl. 13:00 · Jonas" });
    // Newest first: the 13:00 symptom sits above the 12:10 meal.
    const first = screen.getByRole("link", { name: /Rugbrød/ });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowUp" });
    expect(row).toHaveFocus();
    fireEvent.keyDown(row, { key: "ArrowDown" });
    expect(first).toHaveFocus();
  });
});

import "@testing-library/jest-dom/vitest";

import type { DayHistoryView } from "@frejsi/shared/schemas/history";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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

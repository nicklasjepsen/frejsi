import "@testing-library/jest-dom/vitest";

import { readFileSync } from "node:fs";
import path from "node:path";

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import { I18nProvider } from "@/lib/i18n/Provider";
import { getMessages } from "@/lib/i18n/messages";
import type { AppLocale } from "@/lib/i18n/routing";

import { MealStatsTable } from "./MealStatsTable";
import { PeakValue } from "./PeakValue";
import { StatGrid, StatTile } from "./StatTile";
import type { MealStatsRow } from "./types";

const zone = "Europe/Copenhagen";
const mount = (node: ReactNode, locale: AppLocale = "da") =>
  render(
    <I18nProvider locale={locale} messages={getMessages(locale)}>
      {node}
    </I18nProvider>,
  );
afterEach(cleanup);

const css = readFileSync(path.join(import.meta.dirname, "stats.module.css"), "utf8");
const block = (selector: string) => {
  const start = css.indexOf(selector);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  return css.slice(css.indexOf("{", start), css.indexOf("}", start));
};

describe("StatTile (design README)", () => {
  it("renders the label, the value and the footnote in a 3-up or 2-up grid", () => {
    const { container } = mount(
      <>
        <StatGrid columns={3}>
          <StatTile label="I mål 4–10" value="3 t" footnote="af 3 t" />
        </StatGrid>
        <StatGrid columns={2}>
          <StatTile label="Kulhydrat pr. dag" value="116 g" size="week" />
        </StatGrid>
      </>,
    );
    const grids = container.querySelectorAll("[data-columns]");
    expect([...grids].map((g) => g.getAttribute("data-columns"))).toEqual(["3", "2"]);
    expect(screen.getByText("I mål 4–10")).toHaveAttribute("data-part", "label");
    expect(screen.getByText("3 t")).toHaveAttribute("data-part", "value");
    expect(screen.getByText("af 3 t")).toHaveAttribute("data-part", "footnote");
    expect(container.querySelectorAll("[data-part=footnote]")).toHaveLength(1);
  });

  it("styles label 12 muted, value 22 (26 in the week) at 700 tabular, footnote 12 muted", () => {
    expect(block(".label {")).toContain("font-size: 12px");
    expect(block(".label {")).toContain("var(--text-muted)");
    expect(block(".value {")).toMatch(/font-size: 22px[\s\S]*font-weight: 700[\s\S]*tabular-nums/);
    expect(block('.tile[data-size="week"] .value {')).toContain("font-size: 26px");
    expect(block(".footnote {")).toContain("font-size: 12px");
    expect(block(".footnote {")).toContain("var(--text-muted)");
    expect(block('.grid[data-columns="3"] {')).toContain("repeat(3, minmax(0, 1fr))");
    expect(block('.grid[data-columns="2"] {')).toContain("repeat(2, minmax(0, 1fr))");
  });
});

describe("PeakValue", () => {
  const peak = { mmol: 9.6, ts: "2026-10-14T11:15:00.000Z", mealTs: "2026-10-14T10:10:00.000Z" };

  it("takes the peak with its time and the meal's, never a bare number", () => {
    type Peak = ComponentProps<typeof PeakValue>["peak"];
    expectTypeOf<Peak>().toEqualTypeOf<{ mmol: number; ts: string; mealTs: string }>();
    expectTypeOf<number>().not.toExtend<Peak>();
    // @ts-expect-error a value without its time does not render
    const bare = <PeakValue peak={9.6} unit="mmol" timeZone={zone} />;
    expect(bare.props).toHaveProperty("peak", 9.6);
  });

  it("renders the tile with the time after the meal and the clock time as title and label (da)", () => {
    mount(<PeakValue peak={peak} unit="mmol" timeZone={zone} />);
    const value = screen.getByText("9,6");
    expect(value).toHaveAttribute("title", "Top 9,6 kl. 13:15");
    expect(value).toHaveAttribute("aria-label", "Top 9,6 kl. 13:15");
    expect(screen.getByText("Top")).toBeInTheDocument();
    expect(screen.getByText("efter 1 t 05 min")).toBeInTheDocument();
  });

  it("renders the English form, the short desktop footnote and mg/dL", () => {
    mount(<PeakValue peak={peak} unit="mmol" timeZone={zone} />, "en");
    expect(screen.getByText("9.6")).toHaveAttribute("title", "Peak 9.6 at 13:15");
    expect(screen.getByText("after 1 h 05 min")).toBeInTheDocument();
    cleanup();
    mount(<PeakValue peak={peak} unit="mmol" timeZone={zone} duration="short" />);
    expect(screen.getByText("efter 1 t 05")).toBeInTheDocument();
    cleanup();
    mount(<PeakValue peak={peak} unit="mgdl" timeZone={zone} layout="value" />);
    expect(screen.getByText("173")).toHaveAttribute("title", "Top 173 kl. 13:15");
    expect(screen.queryByText(/efter/)).toBeNull();
  });

  it("says minutes alone under an hour", () => {
    mount(
      <PeakValue peak={{ ...peak, ts: "2026-10-14T11:00:00.000Z" }} unit="mmol" timeZone={zone} />,
    );
    expect(screen.getByText("efter 50 min")).toBeInTheDocument();
  });
});

describe("MealStatsTable", () => {
  const inRange = (minutes: number) => ({
    minutes,
    coveredMinutes: 180,
    windowMinutes: 180,
    complete: true,
    belowMinutes: 0,
    aboveMinutes: 180 - minutes,
  });
  const rows: MealStatsRow[] = [
    {
      mealId: "today",
      ts: "2026-10-14T10:10:00.000Z",
      title: "Rugbrød med ost",
      totalCarbs: 50,
      bolusLeadMinutes: 12,
      stats: {
        peak: { mmol: 9.6, ts: "2026-10-14T11:15:00.000Z", minutesAfterMeal: 65 },
        inRange: inRange(180),
        bolusLeadMinutes: 12,
        readingCount: 37,
      },
    },
    {
      mealId: "yesterday",
      ts: "2026-10-13T16:40:00.000Z",
      title: "Rugbrød med ost",
      totalCarbs: 48,
      bolusLeadMinutes: -5,
      stats: {
        peak: { mmol: 10.8, ts: "2026-10-13T17:40:00.000Z", minutesAfterMeal: 60 },
        inRange: inRange(135),
        bolusLeadMinutes: -5,
        readingCount: 37,
      },
    },
    {
      mealId: "older",
      ts: "2026-10-07T16:40:00.000Z",
      title: "Rugbrød med ost",
      totalCarbs: 36,
      stats: {
        inRange: { ...inRange(0), coveredMinutes: 0 },
        readingCount: 0,
      },
    },
  ];
  const now = new Date("2026-10-14T12:00:00.000Z");

  it("has the drawn columns and a clock time in every date cell", () => {
    mount(
      <MealStatsTable
        rows={rows}
        currentMealId="today"
        unit="mmol"
        timeZone={zone}
        now={now}
        onOpen={() => undefined}
      />,
    );
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["Dato", "Kulhydrat", "Bolus før", "Top", "I mål af 3 t"]);
    const body = screen.getAllByRole("row").slice(1);
    const cells = body.map((row) =>
      within(row)
        .getAllByRole("cell")
        .map((c) => c.textContent),
    );
    expect(cells).toEqual([
      ["I dag 12:10", "50 g", "12 min", "9,6", "3 t 00"],
      ["I går 18:40", "48 g", "5 min efter", "10,8", "2 t 15"],
      ["Ons. 7. okt. 18:40", "36 g", "–", "–", "–"],
    ]);
    expect(body[0]).toHaveAttribute("data-current", "true");
    expect(body[1]).not.toHaveAttribute("data-current");
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("moves the selection with J/K and the arrow keys and opens a meal on Enter", () => {
    const onOpen = vi.fn();
    mount(
      <MealStatsTable rows={rows} unit="mmol" timeZone={zone} now={now} onOpen={onOpen} />,
      "en",
    );
    const body = screen.getAllByRole("row").slice(1);
    body[0]?.focus();
    fireEvent.keyDown(body[0] ?? document.body, { key: "ArrowDown" });
    expect(body[1]).toHaveFocus();
    expect(body[1]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(body[1] ?? document.body, { key: "j" });
    expect(body[2]).toHaveFocus();
    fireEvent.keyDown(body[2] ?? document.body, { key: "ArrowUp" });
    fireEvent.keyDown(body[1] ?? document.body, { key: "Enter" });
    expect(onOpen).toHaveBeenCalledWith("yesterday");
    expect(within(body[2] ?? document.body).getByText("Wed 7 Oct 18:40")).toBeInTheDocument();
  });
});

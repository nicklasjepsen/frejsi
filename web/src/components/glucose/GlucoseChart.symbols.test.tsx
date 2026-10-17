import "@testing-library/jest-dom/vitest";

import type { Reading } from "@frejsi/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/lib/i18n/Provider";
import { getMessages } from "@/lib/i18n/messages";
import type { AppLocale } from "@/lib/i18n/routing";

import { GlucoseChart } from "./GlucoseChart";

const MEAL = "2026-10-14T10:10:00.000Z"; // 12:10 Copenhagen
const at = (base: string, minutes: number) =>
  new Date(new Date(base).getTime() + minutes * 60_000).toISOString();
const series = (base: string, from: number, to: number, mmol = 6): Reading[] => {
  const out: Reading[] = [];
  for (let m = from; m <= to; m += 5) out.push({ ts: at(base, m), mmol, trend: "flat" });
  return out;
};
const zone = "Europe/Copenhagen";
const mount = (node: ReactNode, locale: AppLocale = "da") =>
  render(
    <I18nProvider locale={locale} messages={getMessages(locale)}>
      {node}
    </I18nProvider>,
  );
const symbolOf = (root: ParentNode, symbol: string) =>
  root.querySelector(`svg[data-testid=food-symbol][data-symbol=${symbol}]`);

afterEach(cleanup);

describe("the food symbol on the day curve (v0.6.0 plan §7)", () => {
  const base = {
    variant: "day" as const,
    readings: series(MEAL, -60, 120),
    from: new Date("2026-10-14T04:00:00.000Z"),
    to: new Date("2026-10-14T13:13:00.000Z"),
    targetLow: 4,
    targetHigh: 10,
    unit: "mmol" as const,
    timeZone: zone,
  };
  const meals = [{ mealId: "m1", ts: MEAL, bolusTs: at(MEAL, -12), symbol: "bread" as const }];

  it("centres a 12 px symbol on the meal line at markerTop at the phone size, in the meal colour", () => {
    const { container } = mount(<GlucoseChart {...base} size="phone" meals={meals} />);
    const symbol = symbolOf(container, "bread");
    expect(symbol).not.toBeNull();
    expect(symbol).toHaveAttribute("width", "12");
    expect(symbol).toHaveAttribute("aria-hidden", "true");
    const line = screen.getByTestId("meal-line");
    const x = Number(line.getAttribute("x1"));
    // markerTop is 10 % of the 98 px plot: 9.8.
    expect(Number(symbol?.getAttribute("x"))).toBeCloseTo(x - 6, 5);
    expect(Number(symbol?.getAttribute("y"))).toBeCloseTo(9.8 - 6, 5);
    // The line keeps its test id and starts under the symbol instead of through it.
    expect(Number(line.getAttribute("y1"))).toBeGreaterThan(9.8);
    expect(line).toHaveAttribute("y2", "98");
    expect(symbol?.parentElement?.getAttribute("class")).toContain("mealSymbol");
    // The bolus triangle is untouched.
    expect(screen.getByTestId("bolus")).toHaveAttribute("d", expect.stringMatching(/^M[\d.]+ 90 /));
  });

  it("draws it at 16 px on desktop and still draws every meal line", () => {
    const { container } = mount(
      <GlucoseChart
        {...base}
        meals={[...meals, { mealId: "m2", ts: at(MEAL, -180), symbol: "unknown" }]}
      />,
    );
    expect(symbolOf(container, "bread")).toHaveAttribute("width", "16");
    expect(symbolOf(container, "unknown")).toHaveAttribute("height", "16");
    expect(screen.getAllByTestId("meal-line")).toHaveLength(2);
    expect(Number(symbolOf(container, "bread")?.getAttribute("y"))).toBeCloseTo(20 - 8, 5);
  });

  it("names the tap target with the category, and without one for unknown", () => {
    const onMealTap = vi.fn();
    mount(
      <GlucoseChart
        {...base}
        size="phone"
        meals={[...meals, { mealId: "m2", ts: at(MEAL, -180), symbol: "unknown" }]}
        onMealTap={onMealTap}
      />,
    );
    const bread = screen.getByRole("button", { name: "Måltid, Brød, kl. 12:10" });
    expect(bread.style.width).toBe("44px");
    fireEvent.click(bread);
    expect(onMealTap).toHaveBeenCalledWith("m1");
    expect(screen.getByRole("button", { name: "Måltid kl. 09:10" })).toBeInTheDocument();
  });

  it("names it in English too", () => {
    mount(<GlucoseChart {...base} size="phone" meals={meals} onMealTap={vi.fn()} />, "en");
    expect(screen.getByRole("button", { name: "Meal, Bread, at 12:10" })).toBeInTheDocument();
  });

  it("draws no symbol for a meal without one, as the v0.3.0 callers pass them", () => {
    const { container } = mount(
      <GlucoseChart {...base} size="phone" meals={[{ mealId: "m1", ts: MEAL }]} />,
    );
    expect(container.querySelector("[data-testid=food-symbol]")).toBeNull();
    expect(screen.getByTestId("meal-line")).toHaveAttribute("y1", "9.8");
  });
});

describe("the food symbol on the meal curve", () => {
  const props = {
    variant: "meal" as const,
    readings: series(MEAL, -60, 80),
    mealTs: MEAL,
    previous: [],
    target: { low: 4, high: 10 },
    unit: "mmol" as const,
    timeZone: zone,
    now: new Date(at(MEAL, 80)),
  };

  it("sits above plotTop on the meal line: 16 px on desktop, 12 px on the phone", () => {
    const desktop = mount(<GlucoseChart {...props} size="desktop" symbol="starch" />);
    const symbol = symbolOf(desktop.container, "starch");
    expect(symbol).toHaveAttribute("width", "16");
    expect(Number(symbol?.getAttribute("y"))).toBeCloseTo(30 - 16, 5);
    const x = Number(screen.getByTestId("meal-line").getAttribute("x1"));
    expect(Number(symbol?.getAttribute("x"))).toBeCloseTo(x - 8, 5);
    cleanup();
    const phone = mount(<GlucoseChart {...props} size="phone" symbol="starch" />);
    const small = symbolOf(phone.container, "starch");
    expect(small).toHaveAttribute("width", "12");
    expect(Number(small?.getAttribute("y"))).toBeGreaterThanOrEqual(0);
    expect(Number(small?.getAttribute("y"))).toBeLessThanOrEqual(10);
  });

  it("draws none without a symbol", () => {
    const { container } = mount(<GlucoseChart {...props} size="phone" />);
    expect(container.querySelector("[data-testid=food-symbol]")).toBeNull();
  });
});

describe("the food symbol on the week tile", () => {
  const day = {
    variant: "week-tile" as const,
    curve: [{ ts: "2026-10-05T06:00:00.000Z", mmol: 6 }],
    from: new Date("2026-10-04T22:00:00.000Z"),
    to: new Date("2026-10-05T22:00:00.000Z"),
    target: { low: 4, high: 10 },
    timeZone: zone,
  };

  it("draws an 8 px symbol in place of the dot when meals are given", () => {
    const { container } = mount(
      <GlucoseChart
        {...day}
        mealTimes={["2026-10-05T12:00:00.000Z"]}
        meals={[{ ts: "2026-10-05T12:00:00.000Z", symbol: "fruit" }]}
      />,
    );
    expect(container.querySelector("[data-testid=meal-dot]")).toBeNull();
    const symbol = symbolOf(container, "fruit");
    expect(symbol).toHaveAttribute("width", "8");
    // 14:00 Copenhagen lands at 14/24 of 120, centred: 70 − 4.
    expect(Number(symbol?.getAttribute("x"))).toBeCloseTo(66, 5);
    expect(Number(symbol?.getAttribute("y"))).toBeCloseTo(58 - 4, 5);
  });

  it("draws the dot when only mealTimes are given", () => {
    const { container } = mount(<GlucoseChart {...day} mealTimes={["2026-10-05T12:00:00.000Z"]} />);
    expect(container.querySelectorAll("[data-testid=meal-dot]")).toHaveLength(1);
    expect(container.querySelector("[data-testid=food-symbol]")).toBeNull();
  });
});

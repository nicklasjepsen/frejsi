import "@testing-library/jest-dom/vitest";

import type { Reading } from "@frejsi/shared";
import { MealSymbol } from "@frejsi/shared/schemas/food";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/lib/i18n/Provider";
import { getMessages } from "@/lib/i18n/messages";
import type { AppLocale } from "@/lib/i18n/routing";

import { GlucoseChart, symptomTargets } from "./GlucoseChart";
import type { ChartSymptom } from "./chart";

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
const symptom = (id: string, ts: string, kind = "stomach-ache", label = "Ondt i maven") => ({
  id,
  ts,
  kind,
  label,
});
const markers = (root: ParentNode) => [...root.querySelectorAll("[data-testid=symptom-marker]")];

afterEach(cleanup);

const day = {
  variant: "day" as const,
  readings: series(MEAL, -60, 120),
  from: new Date("2026-10-14T04:00:00.000Z"),
  to: new Date("2026-10-14T13:13:00.000Z"),
  targetLow: 4,
  targetHigh: 10,
  unit: "mmol" as const,
  timeZone: zone,
  size: "phone" as const,
};

describe("symptom markers on the day curve (v0.6.0 plan §5, decision 14)", () => {
  it("draws a 10 px diamond on the time axis for each symptom in the window, in the text colour", () => {
    const { container } = mount(
      <GlucoseChart
        {...day}
        symptoms={[
          symptom("s1", at(MEAL, 140)),
          symptom("s2", at(MEAL, -600)), // 02:10, before the window
        ]}
      />,
    );
    const drawn = markers(container);
    expect(drawn).toHaveLength(1);
    const marker = drawn[0];
    expect(marker).toHaveAttribute("aria-hidden", "true");
    expect(marker).toHaveAttribute("data-kind", "stomach-ache");
    expect(marker?.getAttribute("class")).toContain("symptomMarker");
    // 14:30 is 8.5 h into the 9.22 h window on the 296 px plot; the diamond spans 10 px on the baseline (98).
    const d = marker?.getAttribute("d") ?? "";
    const numbers = d.match(/-?[\d.]+/g)?.map(Number) ?? [];
    expect(numbers).toHaveLength(8);
    const xs = [numbers[0], numbers[2], numbers[4], numbers[6]].map(Number);
    const ys = [numbers[1], numbers[3], numbers[5], numbers[7]].map(Number);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(10, 5);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(10, 5);
    expect((Math.max(...ys) + Math.min(...ys)) / 2).toBe(98);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("gives each one a 44 px tap target named '{kind} kl. {time}' that answers with its id", () => {
    const onSymptomTap = vi.fn();
    mount(
      <GlucoseChart
        {...day}
        symptoms={[symptom("s1", at(MEAL, 140)), symptom("s2", at(MEAL, 20), "dizzy", "Svimmel")]}
        onSymptomTap={onSymptomTap}
      />,
    );
    const target = screen.getByRole("button", { name: "Ondt i maven kl. 14:30" });
    expect(target.style.width).toBe("44px");
    expect(target.style.height).toBe("44px");
    fireEvent.click(target);
    expect(onSymptomTap).toHaveBeenCalledWith("s1");
    fireEvent.click(screen.getByRole("button", { name: "Svimmel kl. 12:30" }));
    expect(onSymptomTap).toHaveBeenLastCalledWith("s2");
  });

  it("keeps the meal tap targets next to the symptom ones", () => {
    mount(
      <GlucoseChart
        {...day}
        meals={[{ mealId: "m1", ts: MEAL, symbol: "bread" }]}
        symptoms={[symptom("s1", at(MEAL, 140))]}
        onMealTap={vi.fn()}
        onSymptomTap={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Måltid, Brød, kl. 12:10" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ondt i maven kl. 14:30" })).toBeInTheDocument();
  });
});

describe("symptom markers on the meal curve and the week tile", () => {
  it("draws those within −1 h/+4 h of the meal and names them", () => {
    const onSymptomTap = vi.fn();
    const { container } = mount(
      <GlucoseChart
        variant="meal"
        readings={series(MEAL, -60, 80)}
        mealTs={MEAL}
        previous={[]}
        target={{ low: 4, high: 10 }}
        unit="mmol"
        timeZone={zone}
        now={new Date(at(MEAL, 80))}
        size="phone"
        symptoms={[
          symptom("in", at(MEAL, 90)),
          symptom("late", at(MEAL, 300)), // +5 h, outside
          symptom("early", at(MEAL, -90)), // −1.5 h, outside
        ]}
        onSymptomTap={onSymptomTap}
      />,
    );
    expect(markers(container)).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Ondt i maven kl. 13:40" }));
    expect(onSymptomTap).toHaveBeenCalledWith("in");
  });

  it("draws them on the week tile under the meal symbols, with the same tap target", () => {
    const onSymptomTap = vi.fn();
    const { container } = mount(
      <GlucoseChart
        variant="week-tile"
        curve={[{ ts: "2026-10-05T06:00:00.000Z", mmol: 6 }]}
        mealTimes={["2026-10-05T12:00:00.000Z"]}
        meals={[{ ts: "2026-10-05T12:00:00.000Z", symbol: "fruit" }]}
        symptoms={[symptom("s1", "2026-10-05T16:00:00.000Z", "tired", "Træt")]}
        from={new Date("2026-10-04T22:00:00.000Z")}
        to={new Date("2026-10-05T22:00:00.000Z")}
        target={{ low: 4, high: 10 }}
        timeZone={zone}
        onSymptomTap={onSymptomTap}
      />,
    );
    const marker = markers(container)[0];
    expect(marker).toBeDefined();
    expect(container.querySelector("[data-symbol=fruit]")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Træt kl. 18:00" }));
    expect(onSymptomTap).toHaveBeenCalledWith("s1");
    expect(screen.getByRole("img", { name: "Mandag" })).toBeInTheDocument();
  });
});

describe("a symptom marker is distinguishable at the phone sizes (plan §5)", () => {
  it("differs from every food symbol and the bolus triangle in shape, colour class and test id", () => {
    const { container } = mount(
      <GlucoseChart
        {...day}
        meals={MealSymbol.options.map((symbol, index) => ({
          mealId: symbol,
          ts: at(MEAL, -60 + index * 10),
          symbol,
          ...(index === 0 ? { bolusTs: at(MEAL, -70) } : {}),
        }))}
        symptoms={[symptom("s1", at(MEAL, 140))]}
      />,
    );
    const marker = markers(container)[0];
    const bolus = screen.getByTestId("bolus");
    const foods = [...container.querySelectorAll("[data-testid=food-symbol]")];
    expect(foods).toHaveLength(11);
    if (!marker) throw new Error("no marker");
    // Test ids: three different names.
    expect(
      new Set([
        marker.getAttribute("data-testid"),
        bolus.getAttribute("data-testid"),
        ...foods.map((f) => f.getAttribute("data-testid")),
      ]).size,
    ).toBe(3);
    // Colour: the diamond's class is the text-colour one; the others are the meal classes.
    expect(marker.getAttribute("class")).toContain("symptomMarker");
    expect(bolus.getAttribute("class")).toContain("bolus");
    for (const food of foods)
      expect(food.parentElement?.getAttribute("class")).toContain("mealSymbol");
    // Shape: a four-cornered diamond; the triangle has three corners; the symbols are curves on a 24 grid.
    const corners = (d: string) => (d.match(/[LH]/g) ?? []).length + 1;
    expect(corners(marker.getAttribute("d") ?? "")).toBe(4);
    expect(corners(bolus.getAttribute("d") ?? "")).toBe(3);
    for (const food of foods) {
      expect(food.getAttribute("viewBox")).toBe("0 0 24 24");
      expect(food.querySelector("path")?.getAttribute("d")).not.toBe(marker.getAttribute("d"));
    }
  });
});

export type { ChartSymptom };

describe("neighbouring symptom targets (Codex review)", () => {
  it("each keeps its own target up to halfway to its neighbour, so both open", () => {
    const onSymptomTap = vi.fn();
    mount(
      <GlucoseChart
        {...day}
        symptoms={[symptom("a", at(MEAL, 60)), symptom("b", at(MEAL, 90), "dizzy", "Svimmel")]}
        onSymptomTap={onSymptomTap}
      />,
    );
    const a = screen.getByRole("button", { name: "Ondt i maven kl. 13:10" });
    const b = screen.getByRole("button", { name: "Svimmel kl. 13:40" });
    // 30 min on a 296-unit day of 9.2 h is about 16 units apart: each target ends at the midpoint.
    const edge = (el: HTMLElement) => ({
      left: parseFloat(el.style.left),
      right: parseFloat(el.style.left) + parseFloat(el.style.width),
    });
    expect(edge(a).right).toBeCloseTo(edge(b).left, 3);
    expect(edge(a).right - edge(a).left).toBeLessThan(44);
    fireEvent.click(a);
    fireEvent.click(b);
    expect(onSymptomTap.mock.calls).toEqual([["a"], ["b"]]);
  });

  it("keeps the full 44 px when symptoms are far apart", () => {
    expect(symptomTargets([{ x: 100 }, { x: 200 }], 296, 1)).toEqual([
      { left: 78, width: 44 },
      { left: 178, width: 44 },
    ]);
    expect(symptomTargets([{ x: 100 }, { x: 110 }], 296, 1)).toEqual([
      { left: 78, width: 27 },
      { left: 105, width: 27 },
    ]);
    expect(symptomTargets([{ x: 5 }], 296, 1)).toEqual([{ left: 0, width: 27 }]);
  });
});

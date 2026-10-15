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

afterEach(cleanup);

describe('GlucoseChart variant="meal"', () => {
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

  it("draws the phone curve with its label, band, bounds, line, end dot, meal line, triangle and axis", () => {
    const { container } = mount(<GlucoseChart {...props} size="phone" bolusTs={at(MEAL, -12)} />);
    const svg = screen.getByRole("img", {
      name: "Glukose fra en time før til fire timer efter måltidet",
    });
    expect(svg).toHaveAttribute("viewBox", "0 0 326 118");
    expect(screen.getByTestId("target-band")).toHaveAttribute("y", "60");
    expect(container.querySelectorAll("line[data-testid=bound]")).toHaveLength(2);
    expect(screen.getByTestId("curve")).toHaveAttribute("points", expect.stringMatching(/^0,80 /));
    expect(screen.getByTestId("end-dot")).toHaveAttribute("r", "5");
    expect(screen.getByTestId("meal-line")).toHaveAttribute("x1", "59.2");
    expect(screen.getByTestId("bolus")).toHaveAttribute("aria-label", "Bolus 11:58");
    const ticks = [...container.querySelectorAll("[data-testid=tick]")].map((t) => t.textContent);
    expect(ticks).toEqual(["−1 t", "12:10", "+1 t", "+2 t", "+3 t", "+4 t"]);
    expect(container.querySelector("[data-tick=meal]")).toHaveAttribute("font-weight", "700");
    expect(svg.textContent).toContain("10");
  });

  it("has no triangle without a bolus tap", () => {
    mount(<GlucoseChart {...props} size="phone" />);
    expect(screen.queryByTestId("bolus")).toBeNull();
  });

  it("draws the previous curves faintly behind the main line and names them on desktop", () => {
    const previous = [1, 2, 3, 4, 5].map((d) => {
      const ts = at(MEAL, -d * 24 * 60);
      return { mealTs: ts, readings: series(ts, -60, 240, 7) };
    });
    const { container } = mount(<GlucoseChart {...props} size="desktop" previous={previous} />);
    expect(
      screen.getByRole("img", {
        name: "Glukose fra en time før til fire timer efter, denne og de sidste fem gange",
      }),
    ).toHaveAttribute("viewBox", "0 0 760 262");
    const faint = container.querySelectorAll("polyline[data-testid=previous]");
    expect(faint).toHaveLength(5);
    expect(faint[0]).toHaveAttribute("opacity", "0.16");
    const lines: Element[] = [...container.querySelectorAll("polyline")];
    expect(lines.indexOf(screen.getByTestId("curve"))).toBe(5);
  });

  it("draws the band and the axis but no line without readings, and the English axis", () => {
    const { container } = mount(<GlucoseChart {...props} readings={[]} size="phone" />, "en");
    expect(screen.getByTestId("target-band")).toBeInTheDocument();
    expect(container.querySelector("polyline")).toBeNull();
    expect(container.querySelector("[data-testid=end-dot]")).toBeNull();
    expect(screen.getByRole("img").textContent).toContain("−1 h");
  });

  it("labels a mg/dL space's bounds 180 and 70", () => {
    mount(<GlucoseChart {...props} unit="mgdl" target={{ low: 3.9, high: 10 }} size="phone" />);
    const labels = [...document.querySelectorAll("[data-testid=bound-label]")].map(
      (t) => t.textContent,
    );
    expect(labels).toEqual(["180", "70"]);
  });
});

describe('GlucoseChart variant="week-tile"', () => {
  it("draws the 120×64 tile with the weekday as its label and the meal dots", () => {
    const from = new Date("2026-10-04T22:00:00.000Z"); // Monday 5 October, 00:00 Copenhagen
    const { container } = mount(
      <GlucoseChart
        variant="week-tile"
        curve={series("2026-10-04T22:00:00.000Z", 0, 1410).filter((_, i) => i % 6 === 0)}
        mealTimes={["2026-10-05T06:00:00.000Z", "2026-10-05T16:00:00.000Z"]}
        from={from}
        to={new Date("2026-10-05T22:00:00.000Z")}
        target={{ low: 4, high: 10 }}
        timeZone={zone}
      />,
    );
    const svg = screen.getByRole("img", { name: "Mandag" });
    expect(svg).toHaveAttribute("viewBox", "0 0 120 64");
    expect(container.querySelectorAll("polyline")).toHaveLength(1);
    expect(container.querySelectorAll("circle[data-testid=meal-dot]")).toHaveLength(2);
    expect(container.querySelector("circle[data-testid=meal-dot]")).toHaveAttribute("r", "2.5");
  });
});

describe('GlucoseChart variant="week-tile" with one bucket', () => {
  it("draws a lone bucket as a dot", () => {
    const { container } = mount(
      <GlucoseChart
        variant="week-tile"
        curve={[{ ts: "2026-10-05T06:00:00.000Z", mmol: 6 }]}
        mealTimes={[]}
        from={new Date("2026-10-04T22:00:00.000Z")}
        to={new Date("2026-10-05T22:00:00.000Z")}
        target={{ low: 4, high: 10 }}
        timeZone={zone}
      />,
    );
    expect(container.querySelector("polyline")).toBeNull();
    expect(container.querySelectorAll("[data-testid=lone-point]")).toHaveLength(1);
  });
});

describe('GlucoseChart variant="day" with meals', () => {
  const from = new Date("2026-10-14T04:00:00.000Z");
  const to = new Date("2026-10-14T13:13:00.000Z");
  const base = {
    variant: "day" as const,
    readings: series(MEAL, -60, 120),
    from,
    to,
    targetLow: 4,
    targetHigh: 10,
    unit: "mmol" as const,
    timeZone: zone,
    meals: [{ mealId: "m1", ts: MEAL, bolusTs: at(MEAL, -12) }],
  };

  it("draws meal lines and bolus triangles, and names the day with its meals", () => {
    mount(<GlucoseChart {...base} />);
    expect(
      screen.getByRole("img", { name: "Glukose i dag fra 06:00 til 15:13 med 1 måltid" }),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId("meal-line")).toHaveLength(1);
    expect(screen.getByTestId("bolus")).toHaveAttribute("aria-label", "Bolus 11:58");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("uses the history day label and makes each meal line a 44 px tap target", () => {
    const onMealTap = vi.fn();
    mount(<GlucoseChart {...base} size="phone" labelKind="history" onMealTap={onMealTap} />);
    expect(
      screen.getByRole("img", { name: "Glukose i dag med måltider markeret" }),
    ).toHaveAttribute("viewBox", "0 0 326 118");
    const target = screen.getByRole("button", { name: "Måltid kl. 12:10" });
    expect(target.style.width).toBe("44px");
    fireEvent.click(target);
    expect(onMealTap).toHaveBeenCalledWith("m1");
  });
});

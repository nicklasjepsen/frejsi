import "@testing-library/jest-dom/vitest";

import type { Reading } from "@frejsi/shared";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/lib/i18n/Provider";
import { getMessages } from "@/lib/i18n/messages";
import type { AppLocale } from "@/lib/i18n/routing";

import { ChartCaption } from "./ChartCaption";
import { ChartLegend } from "./ChartLegend";

const mount = (node: ReactNode, locale: AppLocale = "da") =>
  render(
    <I18nProvider locale={locale} messages={getMessages(locale)}>
      {node}
    </I18nProvider>,
  );

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ChartLegend (plan §7)", () => {
  it("meal: a meal bar, a triangle with the bolus time and a faint bar, one entry per key", () => {
    const { container } = mount(
      <ChartLegend
        variant="meal"
        bolusTs="2026-10-14T09:58:00.000Z"
        previous
        timeZone="Europe/Copenhagen"
      />,
    );
    const items = [...container.querySelectorAll("li")].map((li) => li.textContent);
    expect(items).toEqual(["Måltid", "Bolus 11:58", "Tidligere gange"]);
    expect(container.querySelectorAll("li [data-swatch]")).toHaveLength(3);
    expect(
      [...container.querySelectorAll("[data-swatch]")].map((s) => s.getAttribute("data-swatch")),
    ).toEqual(["meal-bar", "triangle", "previous-bar"]);
  });

  it("meal: leaves out the bolus without a tap and the previous curves when there are none", () => {
    const { container } = mount(
      <ChartLegend variant="meal" previous={false} timeZone="Europe/Copenhagen" />,
      "en",
    );
    expect([...container.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["Meal"]);
  });

  it("day: a meal dot, a triangle and the target with the space's bounds and unit", () => {
    const { container } = mount(
      <ChartLegend variant="day" target={{ low: 4, high: 10 }} unit="mmol" />,
    );
    expect([...container.querySelectorAll("li")].map((li) => li.textContent)).toEqual([
      "Måltid",
      "Bolus givet",
      "Mål 4–10 mmol/L",
    ]);
    expect(
      [...container.querySelectorAll("[data-swatch]")].map((s) => s.getAttribute("data-swatch")),
    ).toEqual(["meal-dot", "triangle"]);
  });

  it("day: a mg/dL space shows its bounds in mg/dL", () => {
    mount(<ChartLegend variant="day" target={{ low: 3.9, high: 10 }} unit="mgdl" />, "en");
    expect(screen.getByText("Target 70–180 mg/dL")).toBeInTheDocument();
  });
});

describe("ChartCaption (plan §7, decision 17)", () => {
  const reading = (ts: string): Reading => ({ ts, mmol: 6.2, trend: "flat" });

  it("shows the newest reading's age while the window includes now, and re-renders every 30 s", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T11:13:00.000Z"));
    mount(
      <ChartCaption
        readings={[reading("2026-10-14T11:00:00.000Z"), reading("2026-10-14T11:10:00.000Z")]}
        from={new Date("2026-10-14T09:10:00.000Z")}
        to={new Date("2026-10-14T14:10:00.000Z")}
      />,
    );
    expect(screen.getByText("sidste måling for 3 min. siden")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText("sidste måling for 4 min. siden")).toBeInTheDocument();
  });

  it("takes the age from the newest reading the curve draws, not one outside its window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T11:13:00.000Z"));
    const { container } = mount(
      <ChartCaption
        readings={[
          reading("2026-10-14T11:05:00.000Z"),
          reading("2026-10-14T11:20:00.000Z"),
          reading("2026-10-14T15:00:00.000Z"),
        ]}
        from={new Date("2026-10-14T09:10:00.000Z")}
        to={new Date("2026-10-14T14:10:00.000Z")}
      />,
    );
    expect(container.textContent).toBe("sidste måling for 8 min. siden");
    cleanup();
    const before = mount(
      <ChartCaption
        readings={[reading("2026-10-14T09:00:00.000Z")]}
        from={new Date("2026-10-14T09:10:00.000Z")}
        to={new Date("2026-10-14T14:10:00.000Z")}
      />,
    );
    expect(before.container.textContent).toBe("");
  });

  it("renders nothing when the window is over or has no reading", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T20:00:00.000Z"));
    const { container } = mount(
      <ChartCaption
        readings={[reading("2026-10-14T11:10:00.000Z")]}
        from={new Date("2026-10-14T09:10:00.000Z")}
        to={new Date("2026-10-14T14:10:00.000Z")}
      />,
    );
    expect(container.textContent).toBe("");
    vi.setSystemTime(new Date("2026-10-14T11:13:00.000Z"));
    const empty = mount(
      <ChartCaption
        readings={[]}
        from={new Date("2026-10-14T09:10:00.000Z")}
        to={new Date("2026-10-14T14:10:00.000Z")}
      />,
    );
    expect(empty.container.textContent).toBe("");
  });
});

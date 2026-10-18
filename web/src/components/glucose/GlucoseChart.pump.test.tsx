import "@testing-library/jest-dom/vitest";

import type { Reading } from "@frejsi/shared";
import type { PumpBolusView } from "@frejsi/shared/schemas/pump";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { I18nProvider } from "@/lib/i18n/Provider";
import { getMessages } from "@/lib/i18n/messages";
import type { AppLocale } from "@/lib/i18n/routing";

import { ChartLegend } from "./ChartLegend";
import { GlucoseChart, type DayChartProps } from "./GlucoseChart";

const zone = "Europe/Copenhagen";
const FROM = new Date("2026-10-15T04:00:00.000Z"); // 06:00
const T0 = new Date("2026-10-15T13:13:00.000Z"); // 15:13
const reading = (ts: string, mmol = 6): Reading => ({ ts, mmol, trend: "flat" });
const readings = [reading("2026-10-15T12:00:00.000Z"), reading("2026-10-15T13:10:00.000Z")];
const boluses: PumpBolusView[] = [
  { id: "auto", ts: "2026-10-15T05:10:00.000Z", units: 0.6, kind: "automatic" }, // 07:10
  { id: "lunch", ts: "2026-10-15T09:58:00.000Z", units: 2.4, kind: "standard", mealId: "m1" }, // 11:58
  { id: "ext", ts: "2026-10-15T11:20:00.000Z", units: 1.25, kind: "extended" }, // 13:20
];
const mount = (node: ReactNode, locale: AppLocale = "da") =>
  render(
    <I18nProvider locale={locale} messages={getMessages(locale)}>
      {node}
    </I18nProvider>,
  );
const dayProps: DayChartProps = {
  variant: "day",
  readings,
  from: FROM,
  to: T0,
  targetLow: 4,
  targetHigh: 10,
  unit: "mmol",
  timeZone: zone,
  label: "Glukose i dag",
};

afterEach(cleanup);

describe("pump markers on the day curve (v0.7.0 plan §9)", () => {
  it("draws manual boluses as the terracotta triangle and automatic ones as the hollow marker", () => {
    const { container } = mount(<GlucoseChart {...dayProps} pump={{ boluses }} />);
    const marks = [...container.querySelectorAll("[data-testid=pump-bolus]")];
    expect(marks.map((m) => [m.getAttribute("data-shape"), m.getAttribute("class")])).toEqual([
      ["hollow", expect.stringContaining("autoBolus") as string],
      ["triangle", expect.stringContaining("bolus") as string],
      ["triangle", expect.stringContaining("bolus") as string],
    ]);
    for (const mark of marks) expect(mark).toHaveAttribute("aria-hidden", "true");
  });

  it("draws a meal's own triangle once when the pump list holds its bolus, and a tapped one as before", () => {
    mount(
      <GlucoseChart
        {...dayProps}
        meals={[
          {
            mealId: "m1",
            ts: "2026-10-15T10:05:00.000Z",
            bolusTs: "2026-10-15T09:58:00.000Z",
            pumpBolusId: "lunch",
          },
          { mealId: "m0", ts: "2026-10-15T06:00:00.000Z", bolusTs: "2026-10-15T05:50:00.000Z" },
        ]}
        pump={{ boluses }}
      />,
    );
    expect(screen.getAllByTestId("bolus")).toHaveLength(1);
    expect(screen.getAllByTestId("pump-bolus")).toHaveLength(3);
    // The tapped one keeps its time in the chart's name, as before; the pump ones have buttons.
    expect(screen.getByRole("img")).toHaveAccessibleName("Glukose i dag. Bolus 07:50");
  });

  it("puts the units in 11 px text above each manual triangle on the desktop day curve", () => {
    const { container } = mount(<GlucoseChart {...dayProps} pump={{ boluses }} />);
    const labels = [...container.querySelectorAll("[data-testid=pump-label]")];
    expect(labels.map((l) => l.textContent)).toEqual(["2,4 E", "1,25 E"]);
    for (const label of labels) expect(label).toHaveAttribute("font-size", "11");
  });

  it("gives every marker an accessible name with its time and units, in the reader's locale", () => {
    mount(<GlucoseChart {...dayProps} pump={{ boluses }} />);
    expect(screen.getAllByTestId("pump-tap").map((b) => b.getAttribute("aria-label"))).toEqual([
      "Automatisk bolus 07:10 · 0,6 E",
      "Bolus 11:58 · 2,4 E",
      "Bolus 13:20 · 1,25 E",
    ]);
    cleanup();
    mount(<GlucoseChart {...dayProps} pump={{ boluses }} />, "en");
    expect(screen.getAllByTestId("pump-tap").map((b) => b.getAttribute("aria-label"))).toEqual([
      "Automatic bolus 07:10 · 0.6 U",
      "Bolus 11:58 · 2.4 U",
      "Bolus 13:20 · 1.25 U",
    ]);
  });

  it("on the phone draws no labels and opens a popover on tap, closed again by a second tap or Escape", () => {
    const { container } = mount(<GlucoseChart {...dayProps} size="phone" pump={{ boluses }} />);
    expect(container.querySelector("[data-testid=pump-label]")).toBeNull();
    expect(screen.queryByTestId("pump-popover")).toBeNull();
    const lunch = screen.getByRole("button", { name: "Bolus 11:58 · 2,4 E" });
    expect(lunch).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(lunch);
    expect(lunch).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("pump-popover")).toHaveTextContent("Bolus 11:58 · 2,4 E");
    fireEvent.click(screen.getByRole("button", { name: "Automatisk bolus 07:10 · 0,6 E" }));
    expect(screen.getByTestId("pump-popover")).toHaveTextContent("Automatisk bolus 07:10 · 0,6 E");
    fireEvent.click(screen.getByRole("button", { name: "Automatisk bolus 07:10 · 0,6 E" }));
    expect(screen.queryByTestId("pump-popover")).toBeNull();
    fireEvent.click(lunch);
    fireEvent.keyDown(lunch, { key: "Escape" });
    expect(screen.queryByTestId("pump-popover")).toBeNull();
  });

  it("closes the popover on a tap anywhere else", () => {
    mount(<GlucoseChart {...dayProps} size="phone" pump={{ boluses }} />);
    fireEvent.click(screen.getByRole("button", { name: "Bolus 11:58 · 2,4 E" }));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId("pump-popover")).toBeNull();
  });

  it("draws the reach tick and 'Pumpe til 11:58' only when the record is behind the newest reading", () => {
    const { container } = mount(
      <GlucoseChart {...dayProps} pump={{ boluses, reach: "2026-10-15T09:58:00.000Z" }} />,
    );
    expect(screen.getByTestId("pump-reach")).toBeInTheDocument();
    expect(screen.getByTestId("pump-reach-caption")).toHaveTextContent("Pumpe til 11:58");
    expect(screen.getByRole("img")).toHaveAccessibleName("Glukose i dag. Pumpe til 11:58");
    cleanup();
    mount(<GlucoseChart {...dayProps} pump={{ boluses, reach: "2026-10-15T13:10:00.000Z" }} />);
    expect(screen.queryByTestId("pump-reach")).toBeNull();
    expect(screen.queryByTestId("pump-reach-caption")).toBeNull();
    expect(container.textContent).not.toContain("Pumpe til");
  });

  it("draws the sparkline's boluses with buttons and no labels", () => {
    const { container } = mount(
      <GlucoseChart
        {...dayProps}
        variant="sparkline"
        from={new Date(T0.getTime() - 3 * 60 * 60_000)}
        label="Glukose de seneste 3 timer"
        pump={{ boluses }}
      />,
    );
    expect(screen.getAllByTestId("pump-tap").map((b) => b.getAttribute("aria-label"))).toEqual([
      "Bolus 13:20 · 1,25 E",
    ]);
    expect(container.querySelector("[data-testid=pump-label]")).toBeNull();
  });

  it("renders as before without pump props: no marker, no button, no caption", () => {
    const { container } = mount(<GlucoseChart {...dayProps} />);
    expect(container.querySelector("[data-testid^=pump]")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
  });
});

describe("pump markers on the meal curve (v0.7.0 plan §9)", () => {
  const MEAL = "2026-10-15T10:05:00.000Z"; // 12:05
  const props = {
    variant: "meal" as const,
    readings: [reading("2026-10-15T10:30:00.000Z"), reading("2026-10-15T11:30:00.000Z")],
    mealTs: MEAL,
    bolusTs: "2026-10-15T09:58:00.000Z",
    pumpBolusId: "lunch",
    previous: [],
    target: { low: 4, high: 10 },
    unit: "mmol" as const,
    timeZone: zone,
    now: new Date("2026-10-15T11:35:00.000Z"),
  };

  it.each(["phone", "desktop"] as const)(
    "labels the meal's own bolus with its units on the %s",
    (size) => {
      const { container } = mount(<GlucoseChart {...props} size={size} pump={{ boluses }} />);
      expect(
        [...container.querySelectorAll("[data-testid=pump-label]")].map((l) => l.textContent),
      ).toEqual(["2,4 E"]);
      expect(screen.getAllByTestId("bolus")).toHaveLength(1);
      expect(screen.getByRole("button", { name: "Bolus 11:58 · 2,4 E" })).toBeInTheDocument();
      // Named by its button, so the chart's own name does not say it twice.
      expect(screen.getByRole("img")).toHaveAccessibleName(
        "Glukose fra en time før til fire timer efter måltidet",
      );
    },
  );

  it("shows the automatic boluses in its window as hollow markers with names, and no other meal's bolus", () => {
    const withAuto: PumpBolusView[] = [
      ...boluses,
      { id: "auto2", ts: "2026-10-15T11:00:00.000Z", units: 0.4, kind: "automatic" }, // 13:00
    ];
    mount(<GlucoseChart {...props} size="phone" pump={{ boluses: withAuto }} />);
    const shapes = screen.getAllByTestId("pump-bolus").map((m) => m.getAttribute("data-shape"));
    expect(shapes).toEqual(["hollow"]);
    expect(screen.getAllByTestId("pump-tap").map((b) => b.getAttribute("aria-label"))).toEqual([
      "Bolus 11:58 · 2,4 E",
      "Automatisk bolus 13:00 · 0,4 E",
    ]);
  });

  it("keeps a tapped bolus without a pump link as a bare time in the chart's name", () => {
    mount(<GlucoseChart {...props} pumpBolusId={undefined} size="phone" />);
    expect(screen.queryByTestId("pump-label")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("img")).toHaveAccessibleName(
      "Glukose fra en time før til fire timer efter måltidet. Bolus 11:58",
    );
  });
});

describe("the legend's pump entries (v0.7.0 plan §9)", () => {
  const items = (node: ReactNode) =>
    [...mount(node).container.querySelectorAll("li")].map((li) => li.textContent);

  it("day: 'Bolus (pumpe)' and 'Automatisk bolus' only when such a marker is drawn", () => {
    const target = { low: 4, high: 10 };
    expect(items(<ChartLegend variant="day" bolus={false} target={target} unit="mmol" />)).toEqual([
      "Måltid",
      "Mål 4–10 mmol/L",
    ]);
    cleanup();
    expect(
      items(
        <ChartLegend variant="day" bolus={false} pumpBolus autoBolus target={target} unit="mmol" />,
      ),
    ).toEqual(["Måltid", "Bolus (pumpe)", "Automatisk bolus", "Mål 4–10 mmol/L"]);
    cleanup();
    expect(
      items(
        <ChartLegend variant="day" bolus pumpBolus={false} autoBolus target={target} unit="mmol" />,
      ),
    ).toEqual(["Måltid", "Bolus givet", "Automatisk bolus", "Mål 4–10 mmol/L"]);
  });

  it("meal: 'Automatisk bolus' only when a hollow marker is drawn", () => {
    expect(
      items(<ChartLegend variant="meal" previous={false} timeZone={zone} autoBolus />),
    ).toEqual(["Måltid", "Automatisk bolus"]);
    cleanup();
    const { container } = mount(
      <ChartLegend variant="meal" previous={false} timeZone={zone} autoBolus />,
    );
    expect(container.querySelector("[data-swatch=hollow]")).not.toBeNull();
  });
});

describe("a week tile never draws the pump", () => {
  it("has no pump prop to draw", () => {
    const { container } = mount(
      <GlucoseChart
        variant="week-tile"
        curve={[{ ts: "2026-10-15T10:00:00.000Z", mmol: 6 }]}
        mealTimes={[]}
        from={new Date("2026-10-14T22:00:00.000Z")}
        to={new Date("2026-10-15T22:00:00.000Z")}
        target={{ low: 4, high: 10 }}
        timeZone={zone}
      />,
    );
    expect(container.querySelector("[data-testid^=pump]")).toBeNull();
    expect(within(container).queryByRole("button")).toBeNull();
  });
});

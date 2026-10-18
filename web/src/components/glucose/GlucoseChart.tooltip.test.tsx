import "@testing-library/jest-dom/vitest";

import type { Reading } from "@frejsi/shared";
import type { PumpBolusView } from "@frejsi/shared/schemas/pump";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/lib/i18n/Provider";
import { getMessages } from "@/lib/i18n/messages";
import type { AppLocale } from "@/lib/i18n/routing";

import { GlucoseChart, type DayChartProps, type MealChartProps } from "./GlucoseChart";

// jsdom has no PointerEvent: a MouseEvent with the pointer's type stands in, so the handlers see
// `clientX`, `clientY` and `pointerType` as a browser sends them.
beforeAll(() => {
  if (typeof window.PointerEvent === "undefined") {
    class FakePointerEvent extends MouseEvent {
      pointerType: string;
      pointerId: number;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerType = init.pointerType ?? "mouse";
        this.pointerId = init.pointerId ?? 1;
      }
    }
    Object.defineProperty(window, "PointerEvent", { value: FakePointerEvent, configurable: true });
  }
});

/** The chart is laid out at its viewBox size, so a pixel is a viewBox unit. */
function layout(width: number, height: number) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: width,
    bottom: height,
    width,
    height,
    toJSON: () => ({}),
  });
}

/** The element `selector` finds, or a failed test. */
function found(root: ParentNode, selector: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`Nothing matches ${selector}`);
  return element;
}

const zone = "Europe/Copenhagen";
const FROM = new Date("2026-10-15T04:00:00.000Z"); // 06:00
const T0 = new Date("2026-10-15T13:13:00.000Z"); // 15:13
const SPAN = T0.getTime() - FROM.getTime();
/** The day curve's x for a time: 680 px of plot over 06:00 to 15:13. */
const dayX = (ts: string) => ((new Date(ts).getTime() - FROM.getTime()) / SPAN) * 680;
const series = (from: string, to: string, mmol = 6): Reading[] => {
  const out: Reading[] = [];
  for (let t = new Date(from).getTime(); t <= new Date(to).getTime(); t += 5 * 60_000) {
    out.push({ ts: new Date(t).toISOString(), mmol, trend: "flat" });
  }
  return out;
};
const lunchBolus: PumpBolusView = {
  id: "lunch",
  ts: "2026-10-15T09:58:00.000Z", // 11:58
  units: 2.4,
  kind: "standard",
  mealId: "m1",
};
const mount = (node: ReactNode, locale: AppLocale = "da") =>
  render(
    <I18nProvider locale={locale} messages={getMessages(locale)}>
      {node}
    </I18nProvider>,
  );
const dayProps: DayChartProps = {
  variant: "day",
  readings: series("2026-10-15T08:00:00.000Z", "2026-10-15T13:10:00.000Z"),
  from: FROM,
  to: T0,
  now: T0,
  targetLow: 4,
  targetHigh: 10,
  unit: "mmol",
  timeZone: zone,
  label: "Glukose i dag",
  meals: [{ mealId: "m1", ts: "2026-10-15T10:05:00.000Z", pumpBolusId: "lunch" }],
  symptoms: [{ id: "s1", ts: "2026-10-15T11:00:00.000Z", kind: "stomach", label: "Ondt i maven" }],
  pump: { boluses: [lunchBolus] },
};

const host = () => screen.getByTestId("curve-host");
const tip = () => screen.queryByTestId("curve-tooltip");
const move = (x: number, y: number, pointerType = "mouse") => {
  fireEvent.pointerMove(host(), { clientX: x, clientY: y, pointerType });
};

/** Every age line the glucose messages can print, in both locales. */
const AGE = /siden|lige nu|ago|just now/;
const CLOCK = /\b\d{2}:\d{2}\b/;
const VALUE = /\d+[,.]\d|\d{2,3} mg\/dL/;

beforeEach(() => {
  layout(720, 220);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("the curve's tooltip on the day curve (issue 243)", () => {
  it("shows the reading under the pointer with value, trend, clock and age, a guide and a dot", () => {
    mount(<GlucoseChart {...dayProps} />);
    expect(tip()).toBeNull();
    move(dayX("2026-10-15T12:00:00.000Z") + 1, 60);
    expect(tip()).toHaveTextContent("6,0 mmol/L · stabil · kl. 14:00 · for 1 time 13 min. siden");
    expect(screen.getByTestId("curve-guide")).toBeInTheDocument();
    expect(screen.getByTestId("curve-dot")).toBeInTheDocument();
    fireEvent.pointerLeave(host(), { pointerType: "mouse" });
    expect(tip()).toBeNull();
    expect(screen.queryByTestId("curve-guide")).toBeNull();
  });

  it("speaks mg/dL when the space reads in mg/dL", () => {
    mount(<GlucoseChart {...dayProps} unit="mgdl" />, "en");
    move(dayX("2026-10-15T12:00:00.000Z"), 60);
    expect(tip()).toHaveTextContent("108 mg/dL · steady · 14:00 · 1 h 13 min ago");
  });

  it("leaves the trend out of a reading that has none", () => {
    const readings = dayProps.readings.map((r) => ({ ...r, trend: "not-computable" as const }));
    mount(<GlucoseChart {...dayProps} readings={readings} />);
    move(dayX("2026-10-15T12:00:00.000Z"), 60);
    expect(tip()).toHaveTextContent("6,0 mmol/L · kl. 14:00 · for 1 time 13 min. siden");
  });

  it("names the meal line, the symptom and the pump bolus under the pointer instead", () => {
    mount(<GlucoseChart {...dayProps} />);
    move(dayX("2026-10-15T10:05:00.000Z") + 2, 60);
    expect(tip()).toHaveTextContent("Måltid kl. 12:05");
    expect(screen.queryByTestId("curve-dot")).toBeNull();
    move(dayX("2026-10-15T11:00:00.000Z") + 2, 198);
    expect(tip()).toHaveTextContent("Ondt i maven kl. 13:00");
    move(dayX("2026-10-15T09:58:00.000Z") - 1, 196);
    // The pump's own record, in the pump copy: its time and the units it delivered.
    expect(tip()).toHaveTextContent("Bolus 11:58 · 2,4 E");
  });

  it("names a tapped bolus by its time only", () => {
    mount(
      <GlucoseChart
        {...dayProps}
        meals={[
          { mealId: "m0", ts: "2026-10-15T06:00:00.000Z", bolusTs: "2026-10-15T05:50:00.000Z" },
        ]}
      />,
    );
    move(dayX("2026-10-15T05:50:00.000Z"), 199);
    expect(tip()).toHaveTextContent(/^Bolus 07:50$/);
  });

  it("keeps the marker taps: the pump popover and the meal and symptom buttons still open", () => {
    const onMealTap = vi.fn();
    const onSymptomTap = vi.fn();
    mount(<GlucoseChart {...dayProps} onMealTap={onMealTap} onSymptomTap={onSymptomTap} />);
    const pump = screen.getByRole("button", { name: "Bolus 11:58 · 2,4 E" });
    fireEvent.pointerMove(pump, { clientX: dayX(lunchBolus.ts), clientY: 196 });
    fireEvent.click(pump);
    expect(screen.getByTestId("pump-popover")).toHaveTextContent("Bolus 11:58 · 2,4 E");
    fireEvent.click(screen.getByRole("button", { name: "Måltid kl. 12:05" }));
    expect(onMealTap).toHaveBeenCalledWith("m1");
    fireEvent.click(screen.getByTestId("symptom-tap"));
    expect(onSymptomTap).toHaveBeenCalledWith("s1");
  });

  it("draws the tooltip as a div beside the SVG, out of the pointer's way and inside the chart", () => {
    mount(
      <GlucoseChart
        {...dayProps}
        readings={series("2026-10-15T04:05:00.000Z", "2026-10-15T13:10:00.000Z")}
      />,
    );
    move(10, 60);
    const box = tip();
    expect(box?.tagName).toBe("DIV");
    expect(box).toHaveAttribute("data-anchor", "start");
    expect(box).toHaveAttribute("aria-hidden", "true");
    move(dayX("2026-10-15T13:10:00.000Z"), 60);
    expect(tip()).toHaveAttribute("data-anchor", "end");
    expect(document.querySelector("svg title")).toBeNull();
  });
});

describe("touch: hold to read the curve (issue 243)", () => {
  it("shows the tooltip after a touch-and-hold, follows the finger, and hides on release", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    mount(<GlucoseChart {...dayProps} />);
    const x = dayX("2026-10-15T12:00:00.000Z");
    fireEvent.pointerDown(host(), { clientX: x, clientY: 60, pointerType: "touch" });
    // A touch moving over the curve is not a hover.
    move(x, 60, "touch");
    expect(tip()).toBeNull();
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(tip()).toHaveTextContent("kl. 14:00");
    move(dayX("2026-10-15T12:30:00.000Z"), 60, "touch");
    expect(tip()).toHaveTextContent("kl. 14:30");
    fireEvent.pointerUp(host(), { pointerType: "touch" });
    expect(tip()).toBeNull();
  });

  it("lets a plain tap on a meal line open the meal, and a hold over it does not", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const onMealTap = vi.fn();
    mount(<GlucoseChart {...dayProps} onMealTap={onMealTap} />);
    const meal = screen.getByRole("button", { name: "Måltid kl. 12:05" });
    const x = dayX("2026-10-15T10:05:00.000Z");
    fireEvent.pointerDown(meal, { clientX: x, clientY: 60, pointerType: "touch" });
    fireEvent.pointerUp(meal, { pointerType: "touch" });
    fireEvent.click(meal);
    expect(onMealTap).toHaveBeenCalledTimes(1);
    expect(tip()).toBeNull();

    fireEvent.pointerDown(meal, { clientX: x, clientY: 60, pointerType: "touch" });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(tip()).toHaveTextContent("Måltid kl. 12:05");
    fireEvent.pointerUp(meal, { pointerType: "touch" });
    fireEvent.click(meal);
    expect(onMealTap).toHaveBeenCalledTimes(1);
  });

  it("does not take a finger that moves away before the hold", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    mount(<GlucoseChart {...dayProps} />);
    fireEvent.pointerDown(host(), { clientX: 300, clientY: 60, pointerType: "touch" });
    move(340, 60, "touch");
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(tip()).toBeNull();
  });

  it("turns off the browser's panning on the plot only", () => {
    mount(<GlucoseChart {...dayProps} />);
    expect(host().className).toMatch(/curveHost/);
  });
});

describe("keyboard and screen readers (issue 243)", () => {
  it("moves the guide one reading per arrow and announces it politely", () => {
    mount(<GlucoseChart {...dayProps} />);
    const plot = host();
    expect(plot).toHaveAttribute("tabindex", "0");
    expect(plot).toHaveAccessibleDescription("Brug piletasterne til at gå langs kurven.");
    const live = screen.getByTestId("curve-live");
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(live).toBeEmptyDOMElement();
    plot.focus();
    fireEvent.keyDown(plot, { key: "ArrowLeft" });
    expect(live).toHaveTextContent("6,0 mmol/L · stabil · kl. 15:10 · for 3 min. siden");
    fireEvent.keyDown(plot, { key: "ArrowLeft" });
    expect(live).toHaveTextContent("kl. 15:05 · for 8 min. siden");
    expect(screen.getByTestId("curve-guide")).toBeInTheDocument();
    fireEvent.keyDown(plot, { key: "ArrowRight" });
    expect(live).toHaveTextContent("kl. 15:10");
    fireEvent.keyDown(plot, { key: "Home" });
    expect(live).toHaveTextContent("kl. 10:00");
    fireEvent.keyDown(plot, { key: "Escape" });
    expect(tip()).toBeNull();
    expect(live).toBeEmptyDOMElement();
  });

  it("does not announce a hover, only the keys", () => {
    mount(<GlucoseChart {...dayProps} />);
    move(dayX("2026-10-15T12:00:00.000Z"), 60);
    expect(tip()).not.toBeNull();
    expect(screen.getByTestId("curve-live")).toBeEmptyDOMElement();
  });

  it("reads in English for an English reader", () => {
    mount(<GlucoseChart {...dayProps} />, "en");
    expect(host()).toHaveAccessibleDescription("Use the arrow keys to move along the curve.");
    fireEvent.keyDown(host(), { key: "End" });
    expect(screen.getByTestId("curve-live")).toHaveTextContent(
      "6.0 mmol/L · steady · 15:10 · 3 min ago",
    );
  });
});

describe("the sparkline stays silent (issue 243)", () => {
  it("has no tooltip, no guide and no tab stop", () => {
    layout(326, 140);
    const { container } = mount(
      <GlucoseChart
        variant="sparkline"
        label="Glukose de seneste 3 timer"
        readings={dayProps.readings}
        from={new Date(T0.getTime() - 3 * 60 * 60_000)}
        to={T0}
        targetLow={4}
        targetHigh={10}
        unit="mmol"
        timeZone={zone}
      />,
    );
    expect(screen.queryByTestId("curve-host")).toBeNull();
    fireEvent.pointerMove(container.querySelector("svg") as Element, { clientX: 150, clientY: 50 });
    expect(tip()).toBeNull();
    expect(container.querySelector("[tabindex]")).toBeNull();
  });
});

describe("the meal curve's tooltip (issue 243)", () => {
  const MEAL = "2026-10-14T10:10:00.000Z"; // 12:10
  const at = (minutes: number) =>
    new Date(new Date(MEAL).getTime() + minutes * 60_000).toISOString();
  const props: MealChartProps = {
    variant: "meal",
    readings: series(at(-60), at(80)),
    mealTs: MEAL,
    previous: [],
    target: { low: 4, high: 10 },
    unit: "mmol",
    timeZone: zone,
    now: new Date(at(80)),
    size: "desktop",
  };
  /** The desktop meal curve: 720 px over the five hours, y 30 (20 mmol) to 234 (2 mmol). */
  const mealX = (minutes: number) => ((minutes + 60) / 300) * 720;
  const mealY = (mmol: number) => 234 - ((mmol - 2) / 18) * 204;

  beforeEach(() => {
    layout(760, 262);
  });

  it("shows this meal's reading, and names the meal line", () => {
    mount(<GlucoseChart {...props} />);
    move(mealX(30), mealY(6));
    expect(tip()).toHaveTextContent("6,0 mmol/L · stabil · kl. 12:40 · for 50 min. siden");
    move(mealX(0) + 1, 100);
    expect(tip()).toHaveTextContent("Måltid kl. 12:10");
  });

  it("says which date an earlier curve under the pointer is from, without its value", () => {
    const earlier = "2026-10-08T10:00:00.000Z";
    const later = (m: number) => new Date(new Date(earlier).getTime() + m * 60_000).toISOString();
    mount(
      <GlucoseChart
        {...props}
        previous={[{ mealTs: earlier, readings: series(later(-60), later(240), 12) }]}
      />,
    );
    move(mealX(30), mealY(12) + 2);
    expect(tip()).toHaveTextContent(/^Tidligere gang, 8\. oktober$/);
    move(mealX(30), mealY(6) - 2);
    expect(tip()).toHaveTextContent("6,0 mmol/L");
  });
});

describe("the week tile's tooltip (issue 243)", () => {
  const DAY_FROM = new Date("2026-10-14T22:00:00.000Z"); // Thursday 15 October, 00:00
  const DAY_TO = new Date("2026-10-15T22:00:00.000Z");
  const curve = Array.from({ length: 48 }, (_, i) => ({
    ts: new Date(DAY_FROM.getTime() + i * 30 * 60_000).toISOString(),
    mmol: 7,
  }));
  const tile = (extra: { tooltip?: { unit: "mmol" | "mgdl"; now: Date } } = {}) => (
    <div data-chart-hover="">
      <GlucoseChart
        variant="week-tile"
        curve={curve}
        mealTimes={[]}
        from={DAY_FROM}
        to={DAY_TO}
        target={{ low: 4, high: 10 }}
        timeZone={zone}
        {...extra}
      />
    </div>
  );

  beforeEach(() => {
    layout(120, 64);
  });

  it("shows the day and the reading under the pointer, from anywhere on the tile", () => {
    const { container } = mount(tile({ tooltip: { unit: "mmol", now: T0 } }));
    const area = found(container, "[data-chart-hover]");
    // 12:00 on a 120 px day is x 60.
    fireEvent.pointerMove(area, { clientX: 60, clientY: 20 });
    expect(tip()).toHaveTextContent(
      "Torsdag 15. oktober · 7,0 mmol/L · kl. 12:00 · for 3 timer 13 min. siden",
    );
    fireEvent.pointerLeave(area, { pointerType: "mouse" });
    expect(tip()).toBeNull();
  });

  it("is no tab stop and takes no touch: the tile's own link opens the day", () => {
    const { container } = mount(tile({ tooltip: { unit: "mmol", now: T0 } }));
    expect(container.querySelector("[tabindex]")).toBeNull();
    const area = found(container, "[data-chart-hover]");
    fireEvent.pointerMove(area, { clientX: 60, clientY: 20, pointerType: "touch" });
    expect(tip()).toBeNull();
  });

  it("shows nothing when it does not know the space's unit, rather than guess one", () => {
    const { container } = mount(tile());
    const area = found(container, "[data-chart-hover]");
    fireEvent.pointerMove(area, { clientX: 60, clientY: 20 });
    expect(tip()).toBeNull();
  });
});

describe("hard rule: no glucose value without its clock and age (issue 243)", () => {
  /** Sweeps the pointer across the whole chart and checks every tooltip it shows. */
  function sweep(width: number, height: number, target: () => HTMLElement): string[] {
    const seen: string[] = [];
    for (let x = 0; x <= width; x += 3) {
      for (const y of [5, height * 0.3, height * 0.6, height - 22, height - 2]) {
        fireEvent.pointerMove(target(), { clientX: x, clientY: y });
        const text = tip()?.textContent;
        if (text) seen.push(text);
      }
    }
    return seen;
  }
  const check = (seen: string[]) => {
    expect(seen.length).toBeGreaterThan(0);
    const values = seen.filter((text) => VALUE.test(text) && !/ [EU]$/.test(text));
    expect(values.length).toBeGreaterThan(0);
    for (const text of values) {
      expect(text, `"${text}" shows a value`).toMatch(CLOCK);
      expect(text, `"${text}" shows a value`).toMatch(AGE);
    }
  };

  it.each<AppLocale>(["da", "en"])("holds on the day curve in %s", (locale) => {
    mount(<GlucoseChart {...dayProps} />, locale);
    check(sweep(720, 220, host));
  });

  it("holds on the meal curve, earlier curves included", () => {
    layout(326, 118);
    const MEAL = "2026-10-14T10:10:00.000Z";
    const at = (m: number) => new Date(new Date(MEAL).getTime() + m * 60_000).toISOString();
    mount(
      <GlucoseChart
        variant="meal"
        readings={series(at(-60), at(200), 8)}
        mealTs={MEAL}
        bolusTs={at(-12)}
        previous={[
          {
            mealTs: "2026-10-08T10:00:00.000Z",
            readings: series(at(-6 * 1440 - 60), at(-6 * 1440 + 240), 11),
          },
        ]}
        target={{ low: 4, high: 10 }}
        unit="mmol"
        timeZone={zone}
        now={new Date(at(200))}
        size="phone"
      />,
    );
    check(sweep(326, 118, host));
  });

  it("holds on the week tile", () => {
    layout(120, 64);
    const from = new Date("2026-10-14T22:00:00.000Z");
    const { container } = mount(
      <div data-chart-hover="">
        <GlucoseChart
          variant="week-tile"
          curve={Array.from({ length: 48 }, (_, i) => ({
            ts: new Date(from.getTime() + i * 30 * 60_000).toISOString(),
            mmol: 5 + (i % 5),
          }))}
          mealTimes={[]}
          from={from}
          to={new Date(from.getTime() + 24 * 60 * 60_000)}
          target={{ low: 4, high: 10 }}
          timeZone={zone}
          tooltip={{ unit: "mmol", now: T0 }}
        />
      </div>,
    );
    check(sweep(120, 64, () => found(container, "[data-chart-hover]")));
  });

  it("would fail on a bare value", () => {
    expect(() => {
      check(["6,2 mmol/L · stabil"]);
    }).toThrow();
  });
});

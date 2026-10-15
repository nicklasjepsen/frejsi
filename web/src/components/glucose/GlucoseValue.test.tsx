import "@testing-library/jest-dom/vitest";

import type { Reading } from "@frejsi/shared";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/lib/i18n/Provider";
import { getMessages } from "@/lib/i18n/messages";
import type { AppLocale } from "@/lib/i18n/routing";

import { GlucoseValue, type GlucoseValueProps } from "./GlucoseValue";
import { useNow } from "./useNow";

const T0 = new Date("2026-10-14T13:13:00.000Z");
const minutesAgo = (m: number) => new Date(T0.getTime() - m * 60_000).toISOString();
const reading = (ts: string, mmol = 6.2, trend: Reading["trend"] = "forty-five-up"): Reading => ({
  ts,
  mmol,
  trend,
});

const wrap = (ui: ReactNode, locale: AppLocale = "da") =>
  render(
    <I18nProvider locale={locale} messages={getMessages(locale)} timeZone="Europe/Copenhagen">
      {ui}
    </I18nProvider>,
  );

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("GlucoseValue (plan §9, hard rule: never a value without its age)", () => {
  it("accepts a Reading and never a bare number", () => {
    const props: GlucoseValueProps = {
      reading: reading(minutesAgo(3)),
      unit: "mmol",
      now: T0,
      size: "phone",
    };
    // @ts-expect-error a number has no timestamp; there is no prop for it
    const bare: GlucoseValueProps = { reading: 6.2, unit: "mmol", now: T0, size: "phone" };
    const noTs: GlucoseValueProps = {
      // @ts-expect-error a reading without ts is not a Reading
      reading: { mmol: 6.2, trend: "flat" },
      unit: "mmol",
      now: T0,
      size: "phone",
    };
    expect(props.reading).not.toBeNull();
    expect(bare).toBeDefined();
    expect(noTs).toBeDefined();
  });

  it("renders the number, the arrow with the trend word, and the age in one line (Main)", () => {
    wrap(<GlucoseValue reading={reading(minutesAgo(3))} unit="mmol" now={T0} size="phone" />);
    expect(screen.getByTestId("glucose-number")).toHaveTextContent("6,2");
    expect(screen.getByRole("img", { name: "stiger langsomt" })).toBeInTheDocument();
    expect(screen.getByTestId("glucose-age")).toHaveTextContent(
      "mmol/L · for 3 min. siden · stiger langsomt",
    );
  });

  it("always contains the age, whatever the size or layout", () => {
    const sizes = ["phone", "simple", "desktop", "inline", "preview"] as const;
    for (const size of sizes) {
      for (const layout of ["line", "split"] as const) {
        const { container, unmount } = wrap(
          <GlucoseValue
            reading={reading(minutesAgo(3))}
            unit="mmol"
            now={T0}
            size={size}
            layout={layout}
            showUnit={size !== "simple"}
          />,
        );
        expect(container.textContent, `${size}/${layout}`).toMatch(/for 3 min\. siden/);
        unmount();
      }
    }
  });

  it("splits the trend word onto its own line, capitalised, on desktop (Nu-Desktop)", () => {
    wrap(
      <GlucoseValue
        reading={reading(minutesAgo(3))}
        unit="mmol"
        now={T0}
        size="desktop"
        layout="split"
      />,
    );
    expect(screen.getByTestId("glucose-age")).toHaveTextContent("mmol/L · for 3 min. siden");
    expect(screen.getByTestId("glucose-age")).not.toHaveTextContent("stiger");
    expect(screen.getByText("Stiger langsomt")).toBeInTheDocument();
  });

  it("leaves the unit out in simpleMode (Nu-Simpel) and draws the arrow in a circle", () => {
    wrap(
      <GlucoseValue
        reading={reading(minutesAgo(3))}
        unit="mmol"
        now={T0}
        size="simple"
        showUnit={false}
      />,
    );
    expect(screen.getByTestId("glucose-age")).toHaveTextContent(
      "for 3 min. siden · stiger langsomt",
    );
    expect(screen.getByTestId("glucose-age")).not.toHaveTextContent("mmol");
    expect(screen.getByRole("img").querySelector("circle")).not.toBeNull();
  });

  it("says 'Ingen målinger endnu' before the first reading and shows no number", () => {
    wrap(<GlucoseValue reading={null} unit="mmol" now={T0} size="phone" />);
    expect(screen.getByText("Ingen målinger endnu")).toBeInTheDocument();
    expect(screen.queryByTestId("glucose-number")).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("renders mg/dL spaces as whole numbers", () => {
    wrap(<GlucoseValue reading={reading(minutesAgo(3))} unit="mgdl" now={T0} size="phone" />, "en");
    expect(screen.getByTestId("glucose-number")).toHaveTextContent("112");
    expect(screen.getByTestId("glucose-age")).toHaveTextContent(
      "mg/dL · 3 min ago · rising slowly",
    );
  });

  it("marks itself stale after 15 minutes without a reading", () => {
    const { container, rerender } = wrap(
      <GlucoseValue reading={reading(minutesAgo(14))} unit="mmol" now={T0} size="phone" />,
    );
    expect(container.firstElementChild).not.toHaveAttribute("data-stale");
    rerender(
      <I18nProvider locale="da" messages={getMessages("da")}>
        <GlucoseValue reading={reading(minutesAgo(15))} unit="mmol" now={T0} size="phone" />
      </I18nProvider>,
    );
    expect(container.firstElementChild).toHaveAttribute("data-stale", "true");
    expect(screen.getByTestId("glucose-age")).toHaveTextContent("for 15 min. siden");
  });

  it("counts hours, whole hours without '0 min.', and 'lige nu'", () => {
    const { rerender } = wrap(
      <GlucoseValue reading={reading(minutesAgo(65))} unit="mmol" now={T0} size="phone" />,
    );
    expect(screen.getByTestId("glucose-age")).toHaveTextContent("for 1 time 5 min. siden");
    rerender(
      <I18nProvider locale="da" messages={getMessages("da")}>
        <GlucoseValue reading={reading(minutesAgo(120))} unit="mmol" now={T0} size="phone" />
      </I18nProvider>,
    );
    // Whole hours carry no "0 min.".
    expect(screen.getByTestId("glucose-age")).toHaveTextContent("for 2 timer siden");
    rerender(
      <I18nProvider locale="en" messages={getMessages("en")}>
        <GlucoseValue reading={reading(minutesAgo(120))} unit="mmol" now={T0} size="phone" />
      </I18nProvider>,
    );
    expect(screen.getByTestId("glucose-age")).toHaveTextContent("2 h ago");
    rerender(
      <I18nProvider locale="da" messages={getMessages("da")}>
        <GlucoseValue reading={reading(minutesAgo(0.2))} unit="mmol" now={T0} size="phone" />
      </I18nProvider>,
    );
    expect(screen.getByTestId("glucose-age")).toHaveTextContent(
      "mmol/L · lige nu · stiger langsomt",
    );
  });

  it("re-renders the age every 30 s through useNow", () => {
    vi.useFakeTimers({ now: T0 });
    function Live() {
      const now = useNow();
      return <GlucoseValue reading={reading(minutesAgo(3.7))} unit="mmol" now={now} size="phone" />;
    }
    wrap(<Live />);
    expect(screen.getByTestId("glucose-age")).toHaveTextContent("for 3 min. siden");
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByTestId("glucose-age")).toHaveTextContent("for 4 min. siden");
  });
});

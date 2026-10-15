import "@testing-library/jest-dom/vitest";

import type { Reading } from "@frejsi/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { I18nProvider } from "@/lib/i18n/Provider";
import { getMessages } from "@/lib/i18n/messages";

import { GlucoseChart } from "./GlucoseChart";

const T0 = new Date("2026-10-14T13:13:00.000Z");
const minutesAgo = (m: number) => new Date(T0.getTime() - m * 60_000).toISOString();
const reading = (ts: string, mmol: number): Reading => ({ ts, mmol, trend: "flat" });

afterEach(cleanup);

describe("GlucoseChart", () => {
  it("draws the band, the bounds, the curve, the end dot and the axis for the last three hours", () => {
    const { container } = render(
      <I18nProvider locale="da" messages={getMessages("da")}>
        <GlucoseChart
          readings={[
            reading(minutesAgo(10), 6.0),
            reading(minutesAgo(5), 6.1),
            reading(minutesAgo(0), 6.2),
          ]}
          from={new Date(T0.getTime() - 3 * 60 * 60_000)}
          to={T0}
          targetLow={4}
          targetHigh={10}
          unit="mmol"
          timeZone="Europe/Copenhagen"
          variant="sparkline"
          label="Glukose de seneste 3 timer"
        />
      </I18nProvider>,
    );
    const svg = screen.getByRole("img", { name: "Glukose de seneste 3 timer" });
    expect(svg).toHaveAttribute("viewBox", "0 0 326 140");
    expect(screen.getByTestId("target-band")).toHaveAttribute("y", "40");
    expect(screen.getByTestId("target-band")).toHaveAttribute("height", "60");
    expect(screen.getByTestId("curve")).toHaveAttribute(
      "points",
      expect.stringContaining("296,78"),
    );
    expect(container.querySelectorAll("circle")).toHaveLength(1);
    expect(svg.textContent).toContain("10");
    expect(svg.textContent).toContain("4");
    expect(svg.textContent).toContain("13:00");
    expect(svg.textContent).toContain("15:13");
  });

  it("draws nothing of a curve, but still the band, before the first reading", () => {
    const { container } = render(
      <I18nProvider locale="da" messages={getMessages("da")}>
        <GlucoseChart
          readings={[]}
          from={new Date("2026-10-14T04:00:00.000Z")}
          to={T0}
          targetLow={4}
          targetHigh={10}
          unit="mmol"
          timeZone="Europe/Copenhagen"
          variant="day"
          label="Glukose i dag"
        />
      </I18nProvider>,
    );
    expect(screen.getByTestId("target-band")).toBeInTheDocument();
    expect(container.querySelector("polyline")).toBeNull();
    expect(container.querySelector("circle")).toBeNull();
    expect(screen.getByRole("img").textContent).toContain("06:00");
  });
});

import "@testing-library/jest-dom/vitest";

import { Trend } from "@frejsi/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { I18nProvider } from "@/lib/i18n/Provider";
import { getMessages } from "@/lib/i18n/messages";

import { TrendArrow } from "./TrendArrow";

afterEach(cleanup);

describe("TrendArrow", () => {
  it("names every Dexcom trend in both languages (design gap 4)", () => {
    for (const trend of Trend.options) {
      const { unmount } = render(
        <I18nProvider locale="da" messages={getMessages("da")}>
          <TrendArrow trend={trend} size={40} />
        </I18nProvider>,
      );
      const img = screen.getByRole("img");
      expect(img.getAttribute("aria-label"), trend).toMatch(/\S/);
      expect(img).toHaveAttribute("data-trend", trend);
      unmount();
    }
    expect(getMessages("da").glucose.trend["forty-five-up"]).toBe("stiger langsomt");
    expect(getMessages("da").glucose.trend.flat).toBe("stabil");
  });

  it("rotates the artboard's arrow: up-right as drawn, flat turned to the right, down mirrored", () => {
    const { container } = render(
      <I18nProvider locale="da" messages={getMessages("da")}>
        <TrendArrow trend="forty-five-up" size={40} />
        <TrendArrow trend="flat" size={40} />
        <TrendArrow trend="single-down" size={40} />
        <TrendArrow trend="double-up" size={40} />
      </I18nProvider>,
    );
    const paths = container.querySelectorAll("svg");
    expect(paths[0]?.querySelector("path")).toHaveAttribute("transform", "rotate(0 20 20)");
    expect(paths[1]?.querySelector("path")).toHaveAttribute("transform", "rotate(45 20 20)");
    expect(paths[2]?.querySelector("path")).toHaveAttribute("transform", "rotate(135 20 20)");
    expect(paths[3]?.querySelectorAll("path")).toHaveLength(2);
  });
});

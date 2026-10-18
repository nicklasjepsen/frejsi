import "@testing-library/jest-dom/vitest";

import { WeekHistoryView } from "@frejsi/shared/schemas/history";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { getMessages } from "@/lib/i18n/messages";

import fixture from "./fixtures/week.json";
import { WeekTiles } from "./WeekTiles";

/** The element `selector` finds, or a failed test. */
function found(root: ParentNode, selector: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`Nothing matches ${selector}`);
  return element;
}

const week = WeekHistoryView.parse(fixture);

beforeAll(() => {
  if (typeof window.PointerEvent === "undefined") {
    class FakePointerEvent extends MouseEvent {
      pointerType: string;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerType = init.pointerType ?? "mouse";
      }
    }
    Object.defineProperty(window, "PointerEvent", { value: FakePointerEvent, configurable: true });
  }
});

beforeEach(() => {
  // Each tile's chart laid out at the design's 120×64, so a pixel is a viewBox unit.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 120,
    bottom: 64,
    width: 120,
    height: 64,
    toJSON: () => ({}),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mount(unit?: "mmol" | "mgdl") {
  return render(
    <NextIntlClientProvider locale="da" messages={getMessages("da")}>
      <WeekTiles week={week} locale="da" desktop {...(unit ? { unit } : {})} />
    </NextIntlClientProvider>,
  );
}

const firstTile = (container: HTMLElement) =>
  found(container, `[data-date="${week.days[0]?.date ?? ""}"]`);

describe("the week tile's tooltip (issue 243)", () => {
  it("shows the day and the reading under the pointer, with its clock and age", () => {
    const { container } = mount("mmol");
    const tile = firstTile(container);
    // The fixture's Monday has readings at 12:00 and 12:05, in the middle of the 120 px day.
    fireEvent.pointerMove(tile, { clientX: 60, clientY: 30 });
    expect(screen.getByTestId("curve-tooltip")).toHaveTextContent(
      "Mandag 6. oktober · 6,0 mmol/L · kl. 12:00 · for mere end et døgn siden",
    );
    fireEvent.pointerLeave(tile);
    expect(screen.queryByTestId("curve-tooltip")).toBeNull();
  });

  it("keeps the tile's link as the way to the day, with no tab stop in the chart", () => {
    const { container } = mount("mmol");
    const tile = firstTile(container);
    expect(tile.querySelector("a")).toHaveAttribute(
      "href",
      expect.stringContaining(`/history?date=${week.days[0]?.date ?? ""}`) as string,
    );
    expect(tile.querySelector("[tabindex]")).toBeNull();
  });

  it("stays silent without the space's unit", () => {
    const { container } = mount();
    fireEvent.pointerMove(firstTile(container), { clientX: 60, clientY: 30 });
    expect(screen.queryByTestId("curve-tooltip")).toBeNull();
  });
});

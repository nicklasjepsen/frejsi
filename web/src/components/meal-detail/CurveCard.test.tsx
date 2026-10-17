import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/lib/i18n/Provider";
import { getMessages } from "@/lib/i18n/messages";
import type { FeedEventType } from "@/lib/live/live-feed";

import { CurveCard, type CurveCardProps } from "./CurveCard";
import { curveView, mealView, shift } from "./test-support";

afterEach(cleanup);

function mount(props: Partial<CurveCardProps> = {}) {
  const view = props.view ?? curveView();
  return render(
    <I18nProvider locale="da" messages={getMessages("da")}>
      <CurveCard
        view={view}
        readings={view.readings}
        now={new Date(shift(view.meal.ts, 360))}
        unit="mmol"
        timeZone="Europe/Copenhagen"
        size="phone"
        {...props}
      />
    </I18nProvider>,
  );
}

describe("CurveCard and the meal's food symbol (v0.6.0 plan §7)", () => {
  it("draws the meal's symbol above the plot on its line", () => {
    mount({ view: curveView({ meal: mealView({ symbol: "bread" }) }) });
    const card = screen.getByTestId("curve-card");
    expect(card.querySelector("svg[data-testid=food-symbol]")).toHaveAttribute(
      "data-symbol",
      "bread",
    );
  });

  it("draws the apple for a meal from before the symbol existed", () => {
    mount({ view: curveView({ meal: mealView({ symbol: "unknown" }) }) });
    expect(screen.getByTestId("curve-card").querySelector("[data-symbol=unknown]")).not.toBeNull();
  });
});

describe("CurveCard and the symptoms in the meal's window (v0.6.0 plan §5)", () => {
  const symptom = (id: string, minutes: number) => ({
    id,
    kind: "nausea",
    ts: shift(MEAL_TS_BASE, minutes),
    byUserId: "u1",
    byName: "Jonas",
  });
  const MEAL_TS_BASE = curveView().meal.ts;
  const handlers = new Map<string, () => void>();
  const subscribe = (type: FeedEventType, handler: () => void) => {
    handlers.set(type, handler);
    return () => {
      handlers.delete(type);
    };
  };
  let calls: string[];
  afterEach(() => {
    vi.unstubAllGlobals();
    handlers.clear();
  });
  function stub(symptoms: unknown[]) {
    calls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string) => {
        const url = new URL(input, "https://frejsi.example");
        calls.push(`${url.pathname}${url.search}`);
        if (url.pathname.endsWith("/symptoms/kinds"))
          return Promise.resolve(Response.json({ kinds: [] }));
        return Promise.resolve(Response.json({ symptoms }));
      }),
    );
  }

  it("reads the window's symptoms, draws those inside it and opens the detail with the readings", async () => {
    stub([symptom("in", 90), symptom("out", 300)]);
    const view = curveView();
    mount({ view, spaceId: "s1", subscribe });
    const target = await screen.findByRole("button", { name: "Kvalme kl. 13:30" });
    expect(calls.filter((c) => c.includes("/symptoms?"))).toEqual([
      `/api/spaces/s1/symptoms?from=${encodeURIComponent(view.window.from)}&to=${encodeURIComponent(view.window.to)}`,
    ]);
    expect(
      screen.getByTestId("curve-card").querySelectorAll("[data-testid=symptom-marker]"),
    ).toHaveLength(1);
    fireEvent.click(target);
    const dialog = screen.getByRole("dialog", { name: "Kvalme kl. 13:30" });
    const list = within(dialog).getByRole("list", { name: "Tal omkring" });
    expect(list.textContent).toMatch(/13:00 · /);
    expect(list.textContent).toMatch(/14:00 · /);
    expect(list.textContent).not.toMatch(/12:55 · |14:05 · /);
    handlers.get("symptom.updated")?.();
    await waitFor(() => {
      expect(calls.filter((c) => c.includes("/symptoms?"))).toHaveLength(2);
    });
  });

  it("reads nothing without a space to read from", () => {
    stub([]);
    mount();
    expect(calls).toEqual([]);
  });
});

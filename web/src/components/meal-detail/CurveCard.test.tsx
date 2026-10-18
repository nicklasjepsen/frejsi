import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/lib/i18n/Provider";
import { getMessages } from "@/lib/i18n/messages";
import type { FeedEventType } from "@/lib/live/live-feed";

import { CurveCard, type CurveCardProps } from "./CurveCard";
import { curveView, MEAL_TS, mealView, shift } from "./test-support";

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

describe("CurveCard and the pump record (v0.7.0 plan §9)", () => {
  const BOLUS_TS = shift(MEAL_TS, -12); // 11:48
  const AUTO_TS = shift(MEAL_TS, 75); // 13:15
  const linked = () =>
    curveView({
      meal: mealView({ bolusTs: BOLUS_TS, pumpBolusId: "b-lunch", bolusUnits: 2.4 }),
    });
  const handlers = new Map<string, () => void>();
  const subscribe = (type: FeedEventType, handler: () => void) => {
    handlers.set(type, handler);
    return () => {
      handlers.delete(type);
    };
  };
  let calls: string[];
  let boluses: unknown[];
  afterEach(() => {
    vi.unstubAllGlobals();
    handlers.clear();
  });
  function stub() {
    calls = [];
    boluses = [
      { id: "b-lunch", ts: BOLUS_TS, units: 2.4, kind: "standard", mealId: "m1" },
      { id: "b-auto", ts: AUTO_TS, units: 0.6, kind: "automatic" },
      { id: "b-snack", ts: shift(MEAL_TS, 150), units: 1, kind: "standard", mealId: "m2" },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string) => {
        const url = new URL(input, "https://frejsi.example");
        calls.push(`${url.pathname}${url.search}`);
        if (url.pathname.endsWith("/pump"))
          return Promise.resolve(Response.json({ boluses, status: "connected" }));
        if (url.pathname.endsWith("/symptoms/kinds"))
          return Promise.resolve(Response.json({ kinds: [] }));
        return Promise.resolve(Response.json({ symptoms: [] }));
      }),
    );
  }
  const pumpCalls = () => calls.filter((c) => c.includes("/pump"));

  it.each(["phone", "desktop"] as const)(
    "labels the meal's own bolus with its units on the %s and draws the window's automatic boluses hollow",
    async (size) => {
      stub();
      const view = linked();
      mount({ view, spaceId: "s1", subscribe, size });
      await waitFor(() => {
        expect(screen.getAllByTestId("pump-tap")).toHaveLength(2);
      });
      const card = screen.getByTestId("curve-card");
      expect(
        [...card.querySelectorAll("[data-testid=pump-label]")].map((l) => l.textContent),
      ).toEqual(["2,4 E"]);
      expect(
        [...card.querySelectorAll("[data-testid=pump-bolus]")].map((m) =>
          m.getAttribute("data-shape"),
        ),
      ).toEqual(["hollow"]);
      expect(screen.getAllByTestId("pump-tap").map((b) => b.getAttribute("aria-label"))).toEqual([
        "Bolus 11:48 · 2,4 E",
        "Automatisk bolus 13:15 · 0,6 E",
      ]);
      expect(pumpCalls()).toEqual([
        `/api/spaces/s1/pump?${new URLSearchParams({ from: view.window.from, to: view.window.to }).toString()}`,
      ]);
    },
  );

  it("names the automatic bolus in the phone legend only once one is drawn", async () => {
    stub();
    mount({ view: linked(), spaceId: "s1", subscribe });
    const legend = () =>
      [...screen.getByTestId("curve-card").querySelectorAll("li")].map((li) => li.textContent);
    expect(legend()).not.toContain("Automatisk bolus");
    await waitFor(() => {
      expect(legend()).toContain("Automatisk bolus");
    });
  });

  it("labels the units from the meal before the pump record has arrived", () => {
    stub();
    mount({ view: linked() });
    expect(
      [...screen.getByTestId("curve-card").querySelectorAll("[data-testid=pump-label]")].map(
        (l) => l.textContent,
      ),
    ).toEqual(["2,4 E"]);
    expect(pumpCalls()).toEqual([]);
  });

  it("reads the window again on pump.imported and pump.meals", async () => {
    stub();
    mount({ view: linked(), spaceId: "s1", subscribe });
    await waitFor(() => {
      expect(pumpCalls()).toHaveLength(1);
    });
    handlers.get("pump.imported")?.();
    await waitFor(() => {
      expect(pumpCalls()).toHaveLength(2);
    });
    handlers.get("pump.meals")?.();
    await waitFor(() => {
      expect(pumpCalls()).toHaveLength(3);
    });
  });

  it("never asks for the pump record in simpleMode or for a viewer", async () => {
    stub();
    mount({ view: linked(), spaceId: "s1", subscribe, simpleMode: true });
    cleanup();
    mount({ view: linked(), spaceId: "s1", subscribe, role: "viewer" });
    await waitFor(() => {
      expect(calls.some((c) => c.includes("/symptoms"))).toBe(true);
    });
    expect(pumpCalls()).toEqual([]);
    expect(handlers.has("pump.imported")).toBe(false);
  });

  it("asks nothing for a meal the pump record has not reached, and draws its tapped time as before", async () => {
    stub();
    mount({ view: curveView({ meal: mealView({ bolusTs: BOLUS_TS }) }), spaceId: "s1", subscribe });
    await waitFor(() => {
      expect(calls.some((c) => c.includes("/symptoms"))).toBe(true);
    });
    expect(pumpCalls()).toEqual([]);
    expect(screen.queryByTestId("pump-label")).toBeNull();
    expect(screen.getByRole("img", { name: /Bolus 11:48$/ })).toBeInTheDocument();
  });
});

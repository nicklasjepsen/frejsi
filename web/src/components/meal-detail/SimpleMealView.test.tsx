import "@testing-library/jest-dom/vitest";

import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/lib/i18n/Provider";
import { getMessages } from "@/lib/i18n/messages";

const live = vi.hoisted(() => {
  type Handler = (envelope: { payload: { mealId: string } }) => void;
  const handlers = new Map<string, Set<Handler>>();
  return {
    loaded: true,
    calls: [] as unknown[],
    handlers,
    subscribe: (type: string, handler: Handler) => {
      const set = handlers.get(type) ?? new Set();
      set.add(handler);
      handlers.set(type, set);
      return () => {
        set.delete(handler);
      };
    },
    emit(type: string, mealId: string) {
      for (const handler of handlers.get(type) ?? []) handler({ payload: { mealId } });
    },
  };
});
vi.mock("@/lib/live/useLiveFeed", () => ({
  useLiveFeed: (...args: unknown[]) => {
    live.calls.push(args);
    return { loaded: live.loaded, readings: [], subscribe: live.subscribe };
  },
}));
const navigation = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: navigation.push,
    refresh: navigation.refresh,
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

import { SimpleMealView } from "./SimpleMealView";
import { MEAL_TS, curveView, mealApi, shift, type MealApi } from "./test-support";

let api: MealApi;

function mount() {
  return render(
    <I18nProvider locale="da" messages={getMessages("da")}>
      <SimpleMealView spaceId="s1" mealId="m1" locale="da" timeZone="Europe/Copenhagen" />
    </I18nProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(shift(MEAL_TS, 30)), toFake: ["Date"] });
  live.calls.length = 0;
  live.handlers.clear();
  navigation.push.mockClear();
  navigation.refresh.mockClear();
  live.loaded = true;
  api = mealApi(curveView());
  vi.stubGlobal("fetch", api.fetch);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Måltid · simpleMode (Maaltid-Simpel, the non-AI part)", () => {
  it("shows 'Du spiste kl. 12:00', the photo, the dish, the items and '50 g kulhydrat'", async () => {
    mount();
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent(
      "Du spiste kl. 12:00",
    );
    expect(screen.getByRole("link", { name: "Tilbage" })).toHaveAttribute("href", "/da/now");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      "Rye bread with cheese and an apple",
    );
    expect(
      screen.getByRole("img", { name: "Rye bread with cheese and an apple" }),
    ).toBeInTheDocument();
    const items = within(screen.getByRole("list"));
    expect(items.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Rye bread · 2 slices36 g",
      "Cheese · 1 slice0 g",
      "Apple · 1 medium14 g",
    ]);
    expect(screen.getByText("I alt")).toBeInTheDocument();
    expect(screen.getByText("50 g kulhydrat")).toBeInTheDocument();
  });

  it("has no curve, no tiles, no numbers about glucose, no Ret and no delete", async () => {
    mount();
    await screen.findByRole("heading", { level: 1 });
    const view = screen.getByTestId("simple-meal");
    expect(view.querySelector("svg[role=img]")).toBeNull();
    expect(screen.queryByTestId("meal-tiles")).toBeNull();
    expect(screen.queryByText(/Top|I mål|Bolus|mmol/)).toBeNull();
    expect(screen.queryByRole("link", { name: /Ret/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Slet/ })).toBeNull();
  });

  it("leaves out the v0.4.0 parts: 'Dit billede', 'Det ligner', 'Et gæt', 'Spørg en voksen'", async () => {
    mount();
    await screen.findByRole("heading", { level: 1 });
    for (const text of [/Dit billede/, /Det ligner/, /Et gæt/, /Spørg en voksen/]) {
      expect(screen.queryByText(text)).toBeNull();
    }
  });

  it("reads the meal without glucose: GET meals/[id], never curve or readings", async () => {
    mount();
    await screen.findByRole("heading", { level: 1 });
    expect(api.calls).toEqual(["GET /api/spaces/s1/meals/m1"]);
    expect(live.calls[0]).toEqual(["s1", { readings: false }]);
  });

  it("goes to Nu when the meal is deleted", async () => {
    mount();
    await screen.findByRole("heading", { level: 1 });
    act(() => {
      live.emit("meal.deleted", "m1");
    });
    expect(navigation.push).toHaveBeenCalledWith("/da/now");
  });
});

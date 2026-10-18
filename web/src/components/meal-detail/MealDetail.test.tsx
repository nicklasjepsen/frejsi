import "@testing-library/jest-dom/vitest";

import type { Reading } from "@frejsi/shared/schemas/glucose";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/lib/i18n/Provider";
import { getMessages } from "@/lib/i18n/messages";
import type { AppLocale } from "@/lib/i18n/routing";

const live = vi.hoisted(() => {
  type Handler = (envelope: { payload: { mealId: string } }) => void;
  const handlers = new Map<string, Set<Handler>>();
  return {
    loaded: true,
    readings: [] as Reading[],
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
    return { loaded: live.loaded, readings: live.readings, subscribe: live.subscribe };
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

import { MealDetail, type MealDetailProps } from "./MealDetail";
import { DesktopMealHeader, PhoneMealHeader } from "./MealHeader";
import {
  MEAL_TS,
  TYPICAL,
  curveFixture,
  curveView,
  mealApi,
  mealView,
  previousMeal,
  shift,
  type MealApi,
} from "./test-support";

let api: MealApi;
const DONE = shift(MEAL_TS, 6 * 60); // 18:00 the same day: the window is over

function mount(props: Partial<MealDetailProps> = {}, locale: AppLocale = "da") {
  return render(
    <I18nProvider locale={locale} messages={getMessages(locale)}>
      <MealDetail
        spaceId="s1"
        mealId="m1"
        locale={locale}
        timeZone="Europe/Copenhagen"
        unit="mmol"
        layout="phone"
        {...props}
      />
    </I18nProvider>,
  );
}

const ready = () => screen.findByTestId("curve-card");
/** The meal reads; the curve card's symptom (v0.6.0, #202) and pump-history reads are counted elsewhere. */
const mealCalls = () =>
  api.calls.filter((call) => !call.includes("/symptoms") && !call.includes("/pump"));
const tile = (label: string) => {
  const tiles = within(screen.getByTestId("meal-tiles"));
  const node = tiles.getByText(label).parentElement;
  if (!node) throw new Error(label);
  return node;
};

/** An earlier occurrence as it reads without a stored bolus time (issue #215). */
const withoutBolus = ({
  bolusLeadMinutes: _lead,
  stats: { bolusLeadMinutes: _stats, ...stats },
  ...meal
}: ReturnType<typeof previousMeal>) => ({ ...meal, stats });

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(DONE), toFake: ["Date"] });
  live.readings = [];
  live.calls.length = 0;
  live.handlers.clear();
  navigation.push.mockClear();
  navigation.refresh.mockClear();
  live.loaded = true;
  api = mealApi(
    curveView({
      previous: [
        previousMeal(2),
        previousMeal(5),
        previousMeal(7),
        previousMeal(9),
        previousMeal(13),
      ],
    }),
  );
  vi.stubGlobal("fetch", api.fetch);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Måltid · phone (Maaltid-Telefon)", () => {
  it("draws the meta header: back 'Tilbage', 'I dag 12:00 · Jonas', and the 'Ret måltid' button below the hero", async () => {
    mount();
    await ready();
    const header = screen.getByRole("banner");
    expect(within(header).getByRole("link", { name: "Tilbage" })).toHaveAttribute(
      "href",
      "/da/now",
    );
    expect(within(header).getByText("I dag 12:00 · Jonas")).toBeInTheDocument();
    // No text link in the header any more: the button sits in the action row (task 8).
    expect(within(header).queryByRole("button")).toBeNull();
    const actions = screen.getByTestId("meal-actions");
    const edit = within(actions).getByRole("button", { name: "Ret måltid" });
    expect(edit).toHaveAttribute("data-variant", "secondary");
    expect(within(actions).getByRole("button", { name: "Gem som egen ret" })).toBeVisible();
    fireEvent.click(edit);
    expect(screen.getByRole("dialog", { name: "Ret måltid" })).toBeVisible();
  });

  it("says 'I går', else the weekday and date, in the space's timezone", async () => {
    vi.setSystemTime(new Date(shift(MEAL_TS, 24 * 60)));
    mount();
    await ready();
    expect(screen.getByText("I går 12:00 · Jonas")).toBeInTheDocument();
    cleanup();
    vi.setSystemTime(new Date(shift(MEAL_TS, 4 * 24 * 60)));
    mount();
    await ready();
    expect(screen.getByText("Ons. 14. okt. 12:00 · Jonas")).toBeInTheDocument();
  });

  it("shows the photo placeholder, the serif title and '50 g kulhydrat · 3 ting'", async () => {
    mount();
    await ready();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Rye bread with cheese and an apple",
    );
    expect(screen.getByText("50 g kulhydrat · 3 ting")).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Rye bread with cheese and an apple" }),
    ).toBeInTheDocument();
  });

  it("draws the meal curve with three earlier curves behind, the legend and the subtitle", async () => {
    mount();
    const card = within(await ready());
    expect(card.getByRole("heading", { name: "Hvad skete der bagefter" })).toBeInTheDocument();
    expect(card.getByText("Sidste 3 gange bagved")).toBeInTheDocument();
    const chart = card.getByRole("img", {
      name: /^Glukose fra en time før til fire timer efter måltidet/,
    });
    expect(chart).toHaveAttribute("viewBox", "0 0 326 118");
    const previous = new Set(
      [...chart.querySelectorAll("[data-testid=previous]")].map((n) => n.getAttribute("points")),
    );
    expect(previous.size).toBe(3);
    expect(chart.querySelectorAll("[data-testid=meal-line]")).toHaveLength(1);
    expect(chart.querySelector("[data-testid=bolus]")).not.toBeNull();
    const legend = [...card.getByRole("list").querySelectorAll("li")].map((li) => li.textContent);
    expect(legend).toEqual(["Måltid", "Bolus 11:48", "Tidligere gange"]);
    // The window is over: no live age caption.
    expect(card.queryByTestId("chart-caption")).toBeNull();
  });

  it("leaves out the subtitle and the 'Tidligere gange' entry without earlier occurrences, and the bolus entry without a tap", async () => {
    api.curve = curveView({ meal: mealView({ bolusTs: undefined }) });
    mount();
    const card = within(await ready());
    expect(card.queryByText(/bagved/)).toBeNull();
    const legend = [...card.getByRole("list").querySelectorAll("li")].map((li) => li.textContent);
    expect(legend).toEqual(["Måltid"]);
    expect(
      card.getByRole("img", { name: /Glukose/ }).querySelector("[data-testid=bolus]"),
    ).toBeNull();
  });

  it("shows the three tiles: 'Top 9,6 efter 1 t 05 min', 'I mål 4–10 3 t af 3 t', 'Bolus 12 min før måltidet'", async () => {
    mount();
    await ready();
    expect(tile("Top")).toHaveTextContent("Top9,6efter 1 t 05 min");
    // The peak is never a bare value: its clock time is its name.
    expect(screen.getByRole("img", { name: "Top 9,6 kl. 13:05" })).toBeInTheDocument();
    expect(tile("I mål 4–10")).toHaveTextContent("I mål 4–103 taf 3 t");
    expect(tile("Bolus")).toHaveTextContent("Bolus12 minfør måltidet");
  });

  it("says 'indtil nu' while the window is open, and shows the newest reading's age", async () => {
    const now = shift(MEAL_TS, 80);
    vi.setSystemTime(new Date(shift(now, 3)));
    api.curve = curveView({ now });
    mount();
    const card = within(await ready());
    expect(tile("I mål 4–10")).toHaveTextContent("I mål 4–101 t 20 minaf 3 t indtil nu");
    expect(card.getByTestId("chart-caption")).toHaveTextContent("sidste måling for 3 min. siden");
  });

  it("says 'efter måltidet' for a stored time after the meal", async () => {
    api.curve = curveView({ meal: mealView({ bolusTs: shift(MEAL_TS, 5) }) });
    mount();
    await ready();
    expect(tile("Bolus")).toHaveTextContent("Bolus5 minefter måltidet");
    expect(screen.getByTestId("meal-tiles").querySelector("[data-columns]")).toHaveAttribute(
      "data-columns",
      "3",
    );
  });

  // Issue #215: without a stored bolus time the tile is left out, not shown as "ikke registreret".
  it("leaves out the bolus tile without a stored time, and keeps the other two", async () => {
    api.curve = curveView({ meal: mealView({ bolusTs: undefined }) });
    mount();
    await ready();
    const tiles = screen.getByTestId("meal-tiles");
    expect(tile("Top")).toHaveTextContent("Top9,6efter 1 t 05 min");
    expect(tile("I mål 4–10")).toHaveTextContent("I mål 4–103 taf 3 t");
    expect(tiles.querySelectorAll('[data-part="label"]')).toHaveLength(2);
    expect(tiles.querySelector("[data-columns]")).toHaveAttribute("data-columns", "2");
    expect(tiles.textContent).not.toMatch(/bolus|registreret/i);
  });

  it("takes the range bounds from the space and draws mg/dL spaces in mg/dL", async () => {
    api.curve = curveView({ target: { low: 3.9, high: 8 } });
    mount({ unit: "mgdl" });
    await ready();
    expect(within(screen.getByTestId("meal-tiles")).getByText("I mål 70–144")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Top 173 kl. 13:05" })).toBeInTheDocument();
  });

  it("lists the items as '{name} · {portion}' with the carbs right, '0 g' muted, and no AI observation", async () => {
    mount();
    await ready();
    const rows = [...screen.getByTestId("meal-items").querySelectorAll("li")];
    expect(rows.map((r) => r.textContent)).toEqual([
      "Rye bread · 2 slices36 g",
      "Cheese · 1 slice0 g",
      "Apple · 1 medium14 g",
    ]);
    expect(rows[1]?.querySelector("[data-part=carbs]")).toHaveAttribute("data-zero", "true");
    expect(rows[0]?.querySelector("[data-part=carbs]")).toHaveAttribute("data-zero", "false");
    expect(screen.queryByText(/Observation|ikke et råd/)).toBeNull();
    expect(screen.queryByText("I alt")).toBeNull();
  });

  it("shows the band, the axis and 'Ingen målinger i dette tidsrum' for a window without readings", async () => {
    api.curve = curveView({ readings: [] });
    mount();
    const card = within(await ready());
    expect(card.getByText("Ingen målinger i dette tidsrum")).toBeInTheDocument();
    const chart = card.getByRole("img", { name: /Glukose/ });
    expect(chart.querySelector("[data-testid=target-band]")).not.toBeNull();
    expect(chart.querySelectorAll("[data-testid=tick]")).toHaveLength(6);
    expect(chart.querySelector("[data-testid=curve]")).toBeNull();
    expect(tile("Top")).toHaveTextContent("Top–");
  });

  it("keeps the card and tile heights while loading", () => {
    mount();
    expect(screen.getByTestId("curve-card-skeleton")).toBeInTheDocument();
    expect(screen.getByTestId("meal-tiles-skeleton")).toBeInTheDocument();
    expect(screen.getByLabelText("Henter måltidet")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("link", { name: "Tilbage" })).toHaveAttribute("href", "/da/now");
  });

  it("says so when the meal is gone, and offers a retry when the read failed", async () => {
    api.status = 404;
    mount();
    expect(await screen.findByText("Måltidet findes ikke længere.")).toBeInTheDocument();
    cleanup();
    api.status = 500;
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Prøv igen" }));
    api.status = null;
    await ready();
  });

  it("has no delete control and no tab bar of its own (the screen covers the shell)", async () => {
    mount();
    await ready();
    expect(screen.queryByRole("button", { name: /Slet/ })).toBeNull();
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.getByTestId("meal-detail")).toHaveAttribute("data-layout", "phone");
  });

  it("renders in English", async () => {
    mount({}, "en");
    await ready();
    expect(screen.getByText("Today 12:00 · Jonas")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit meal" })).toBeVisible();
    expect(screen.getByText("50 g carbs · 3 items")).toBeInTheDocument();
    expect(tile("Peak")).toHaveTextContent("Peak9.6after 1 h 05 min");
    expect(tile("Bolus")).toHaveTextContent("Bolus12 minbefore the meal");
  });
});

describe("Måltid · opened on ?edit=1", () => {
  it.each(["phone", "desktop"] as const)(
    "%s: arrives with the sheet open, and closing it drops the parameter without a reload",
    async (layout) => {
      window.history.replaceState(null, "", "/da/meal/m1?edit=1");
      mount({ layout, edit: true });
      await ready();
      const sheet = screen.getByRole("dialog", { name: "Ret måltid" });
      expect(sheet).toBeVisible();
      fireEvent.click(within(sheet).getByRole("button", { name: "Tilbage" }));
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(window.location.pathname).toBe("/da/meal/m1");
      expect(window.location.search).toBe("");
      expect(navigation.push).not.toHaveBeenCalled();
      expect(navigation.refresh).not.toHaveBeenCalled();
      // Opening it again from the header leaves the address alone.
      fireEvent.click(screen.getByRole("button", { name: layout === "phone" ? /^Ret/ : "Ret E" }));
      expect(screen.getByRole("dialog", { name: "Ret måltid" })).toBeVisible();
      expect(window.location.search).toBe("");
    },
  );

  it("keeps other parameters when it drops edit, and shows no sheet without the flag", async () => {
    window.history.replaceState(null, "", "/da/meal/m1?edit=1&from=history");
    mount({ edit: true });
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Tilbage" }));
    expect(window.location.search).toBe("?from=history");
    cleanup();
    window.history.replaceState(null, "", "/da/meal/m1");
    mount();
    await ready();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("Måltid · the header's action row", () => {
  const header = (size: "phone" | "desktop", extra?: ReactNode) =>
    render(
      <I18nProvider locale="da" messages={getMessages("da")}>
        {size === "phone" ? (
          <PhoneMealHeader
            meal={mealView()}
            timeZone="Europe/Copenhagen"
            onEdit={vi.fn()}
            backHref="/da/now"
            saveDish={<button type="button">Gem som egen ret</button>}
            saveRecipe={extra}
          />
        ) : (
          <DesktopMealHeader
            meal={mealView()}
            timeZone="Europe/Copenhagen"
            onEdit={vi.fn()}
            saveDish={<button type="button">Gem som egen ret</button>}
            saveRecipe={extra}
          />
        )}
      </I18nProvider>,
    );

  it.each(["phone", "desktop"] as const)(
    "%s: takes 'Ret', SaveAsDish and a second optional action, in that order",
    (size) => {
      header(size, <button type="button">Gem som opskrift</button>);
      const actions = within(screen.getByTestId("meal-actions"));
      expect(actions.getAllByRole("button").map((b) => b.textContent)).toEqual([
        size === "phone" ? "Ret måltid" : "RetE",
        "Gem som egen ret",
        "Gem som opskrift",
      ]);
      cleanup();
      header(size);
      expect(
        within(screen.getByTestId("meal-actions"))
          .getAllByRole("button")
          .map((b) => b.textContent),
      ).toEqual([size === "phone" ? "Ret måltid" : "RetE", "Gem som egen ret"]);
    },
  );
});

describe("Måltid · desktop (Maaltid-Desktop)", () => {
  it("draws the banner, the 26 px title, 'Onsdag 14. oktober · 12:00 · logget af Jonas' and 'Ret' with E", async () => {
    mount({ layout: "desktop" });
    await ready();
    expect(screen.getByRole("heading", { level: 1 })).toHaveAttribute("data-size", "desktop");
    expect(screen.getByText("Onsdag 14. oktober · 12:00 · logget af Jonas")).toBeInTheDocument();
    const edit = screen.getByRole("button", { name: "Ret E" });
    fireEvent.click(edit);
    expect(screen.getByRole("dialog", { name: "Ret måltid" })).toBeVisible();
    expect(edit.querySelector("kbd")).toHaveTextContent("E");
  });

  it("lists the items with 'I alt 50 g' and the short tile footnotes", async () => {
    mount({ layout: "desktop" });
    await ready();
    const rows = [...screen.getByTestId("meal-items").querySelectorAll("li")];
    expect(rows.at(-1)).toHaveTextContent("I alt50 g");
    expect(tile("Top")).toHaveTextContent("Top9,6efter 1 t 05");
    expect(tile("I mål 4–10")).toHaveTextContent("I mål 4–103 taf 3 t");
    expect(tile("Bolus")).toHaveTextContent("Bolus12 minfør");
  });

  // Issue #215: the compare table's "Bolus før" column shows only when a meal in it has a time.
  it("shows the 'Bolus før' column in the compare when a meal in it has a stored time", async () => {
    api.curve = curveView({
      meal: mealView({ bolusTs: undefined }),
      previous: [withoutBolus(previousMeal(2)), previousMeal(5)],
    });
    mount({ layout: "desktop" });
    await ready();
    const table = screen.getByRole("table");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((h) => h.textContent),
    ).toEqual(["Dato", "Kulhydrat", "Bolus før", "Top", "I mål af 3 t"]);
    const leads = within(table)
      .getAllByRole("row")
      .slice(1)
      .map((row) => within(row).getAllByRole("cell")[2]?.textContent);
    expect(leads).toEqual(["–", "–", "10 min"]);
  });

  it("leaves out the 'Bolus før' column and the bolus tile when no meal in the compare has a time", async () => {
    api.curve = curveView({
      meal: mealView({ bolusTs: undefined }),
      previous: [withoutBolus(previousMeal(2)), withoutBolus(previousMeal(5))],
    });
    mount({ layout: "desktop" });
    await ready();
    const table = screen.getByRole("table");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((h) => h.textContent),
    ).toEqual(["Dato", "Kulhydrat", "Top", "I mål af 3 t"]);
    expect(table.textContent).not.toMatch(/bolus/i);
    expect(screen.getByTestId("meal-tiles").textContent).not.toMatch(/bolus/i);
  });

  it("switches the five earlier curves with the chips, 'Sammen med de sidste 5 gange' pressed by default", async () => {
    mount({ layout: "desktop" });
    const card = within(await ready());
    const group = card.getByRole("radiogroup");
    const only = within(group).getByRole("radio", { name: "Kun denne gang" });
    const together = within(group).getByRole("radio", { name: "Sammen med de sidste 5 gange" });
    expect(together).toHaveAttribute("aria-checked", "true");
    const chart = () => card.getByRole("img", { name: /^Glukose fra en time før/ });
    expect(chart()).toHaveAttribute("viewBox", "0 0 760 262");
    expect(chart()).toHaveAccessibleName(/denne og de sidste fem gange/);
    expect(chart().querySelectorAll("[data-testid=previous]").length).toBeGreaterThanOrEqual(5);
    fireEvent.click(only);
    expect(only).toHaveAttribute("aria-checked", "true");
    expect(chart().querySelectorAll("[data-testid=previous]")).toHaveLength(0);
    expect(card.queryByRole("list")).toBeNull();
    fireEvent.click(together);
    expect(chart().querySelectorAll("[data-testid=previous]").length).toBeGreaterThanOrEqual(5);
  });

  it("shows no chips without earlier occurrences, and no AI observation", async () => {
    api.curve = curveView();
    mount({ layout: "desktop" });
    const card = within(await ready());
    expect(card.queryByRole("radiogroup")).toBeNull();
    expect(screen.queryByText(/Observation/)).toBeNull();
  });

  it("opens the edit sheet with E, but not while typing or with a modifier", async () => {
    mount({ layout: "desktop" });
    await ready();
    fireEvent.keyDown(window, { key: "e", ctrlKey: true });
    expect(navigation.push).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "e" });
    expect(screen.getByRole("dialog", { name: "Ret måltid" })).toBeVisible();
  });

  it("ignores E on the phone", async () => {
    mount();
    await ready();
    fireEvent.keyDown(window, { key: "e" });
    expect(navigation.push).not.toHaveBeenCalled();
  });
});

describe("Måltid · live (plan §8)", () => {
  const OPEN = shift(MEAL_TS, 60);
  const inProgress = () => {
    const fixture = curveFixture("meal-in-progress");
    vi.setSystemTime(new Date(shift(OPEN, 2)));
    return curveView({ readings: fixture.readings, now: OPEN });
  };

  it("opens the feed without its readings window and calls no route but curve", async () => {
    mount();
    await ready();
    expect(live.calls[0]).toEqual(["s1", { readings: false }]);
    expect(mealCalls()).toEqual(["GET /api/spaces/s1/meals/m1/curve"]);
  });

  it("merges a new reading from the hook by ts and recomputes the peak", async () => {
    api.curve = inProgress();
    const { rerender } = mount();
    await ready();
    const before = tile("Top").textContent;
    expect(before).toMatch(/^Top/);
    const points = () =>
      screen
        .getByRole("img", { name: /^Glukose/ })
        .querySelector("[data-testid=curve]")
        ?.getAttribute("points") ?? "";
    const drawn = points().split(" ").length;
    live.readings = [
      // Outside the window: ignored.
      { ts: shift(MEAL_TS, -120), mmol: 18, trend: "flat" },
      { ts: shift(OPEN, 1), mmol: 12.4, trend: "single-up" },
    ];
    rerender(
      <I18nProvider locale="da" messages={getMessages("da")}>
        <MealDetail
          spaceId="s1"
          mealId="m1"
          locale="da"
          timeZone="Europe/Copenhagen"
          unit="mmol"
          layout="phone"
        />
      </I18nProvider>,
    );
    expect(tile("Top")).toHaveTextContent("Top12,4efter 1 t 01 min");
    expect(points().split(" ").length).toBe(drawn + 1);
    expect(screen.getByTestId("chart-caption")).toHaveTextContent("sidste måling for 1 min. siden");
  });

  it("refetches the curve on meal.updated for this meal only", async () => {
    mount();
    await ready();
    act(() => {
      live.emit("meal.updated", "other");
    });
    expect(mealCalls()).toHaveLength(1);
    api.curve = curveView({ meal: mealView({ title: "Rye bread with cheese" }) });
    act(() => {
      live.emit("meal.updated", "m1");
    });
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Rye bread with cheese");
    });
    expect(mealCalls()).toHaveLength(2);
  });

  it("reads the curve again once the feed has its cursor", async () => {
    live.loaded = false;
    const { rerender } = mount();
    await ready();
    expect(mealCalls()).toHaveLength(1);
    live.loaded = true;
    rerender(
      <I18nProvider locale="da" messages={getMessages("da")}>
        <MealDetail
          spaceId="s1"
          mealId="m1"
          locale="da"
          timeZone="Europe/Copenhagen"
          unit="mmol"
          layout="phone"
        />
      </I18nProvider>,
    );
    await waitFor(() => {
      expect(mealCalls()).toHaveLength(2);
    });
    expect(screen.getByTestId("curve-card")).toBeInTheDocument();
  });

  it("reads the curve and the page again on space.updated (target, unit, timezone)", async () => {
    mount();
    await ready();
    api.curve = curveView({ target: { low: 5, high: 9 } });
    act(() => {
      live.emit("space.updated", "");
    });
    expect(navigation.refresh).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(within(screen.getByTestId("meal-tiles")).getByText("I mål 5–9")).toBeInTheDocument();
    });
  });

  it("goes to Nu on meal.deleted for this meal only", async () => {
    mount();
    await ready();
    act(() => {
      live.emit("meal.deleted", "other");
    });
    expect(navigation.push).not.toHaveBeenCalled();
    act(() => {
      live.emit("meal.deleted", "m1");
    });
    expect(navigation.push).toHaveBeenCalledWith("/da/now");
  });

  // v0.7.0: a meal write elsewhere can re-match this meal's bolus; that goes out as pump.meals.
  it("reads the curve again when pump.meals lists this meal, and goes to Nu when it removed it", async () => {
    const pumpMeals = (payload: { updated: string[]; removed: string[] }) => {
      for (const handler of live.handlers.get("pump.meals") ?? [])
        (handler as unknown as (e: unknown) => void)({ payload: { created: [], ...payload } });
    };
    api.curve = curveView({ meal: mealView({ bolusUnits: 2.4, pumpBolusId: "b1" }) });
    mount();
    await ready();
    act(() => {
      pumpMeals({ updated: ["other"], removed: ["another"] });
    });
    expect(mealCalls()).toHaveLength(1);
    expect(navigation.push).not.toHaveBeenCalled();
    api.curve = curveView({ meal: mealView({ bolusTs: undefined }) });
    act(() => {
      pumpMeals({ updated: ["m1"], removed: [] });
    });
    await waitFor(() => {
      expect(screen.queryByTestId("meal-bolus")).toBeNull();
    });
    expect(mealCalls()).toHaveLength(2);
    act(() => {
      pumpMeals({ updated: [], removed: ["m1"] });
    });
    expect(navigation.push).toHaveBeenCalledWith("/da/now");
  });

  it("keeps the meal on screen when a refetch fails", async () => {
    mount();
    await ready();
    api.status = 500;
    act(() => {
      live.emit("meal.updated", "m1");
    });
    await waitFor(() => {
      expect(mealCalls()).toHaveLength(2);
    });
    expect(screen.getByTestId("curve-card")).toBeInTheDocument();
  });
});

describe("Måltid · the pump record (v0.7.0 plan §9)", () => {
  /** The 11:58 bolus the pump record linked: 2.4 units, 45 g typed into the pump. */
  const linked = (fields: Parameters<typeof mealView>[0] = {}) =>
    mealView({
      bolusTs: shift(MEAL_TS, -2),
      bolusUnits: 2.4,
      pumpCarbs: 45,
      pumpBolusId: "b1",
      ...fields,
    });
  it.each(["phone", "desktop"] as const)(
    "%s: shows the bolus time with its units and 'Pumpen: 45 g' next to the logged total",
    async (layout) => {
      api.curve = curveView({ meal: linked() });
      mount({ layout });
      await ready();
      expect(screen.getByText("Bolus 11:58 · 2,4 E")).toBeInTheDocument();
      expect(screen.getByText(/Pumpen: 45 g/)).toBeInTheDocument();
      if (layout === "phone")
        expect(screen.getByText("50 g kulhydrat · 3 ting · Pumpen: 45 g")).toBeInTheDocument();
      else {
        const rows = [...screen.getByTestId("meal-items").querySelectorAll("li")];
        expect(rows.at(-2)).toHaveTextContent("I alt50 g");
        expect(rows.at(-1)).toHaveTextContent("Pumpen: 45 g");
      }
      expect(screen.queryByText("Fra pumpen · ikke tjekket")).toBeNull();
      expect(screen.queryByRole("button", { name: "Det passer" })).toBeNull();
    },
  );
  it("shows the units without 'Pumpen' when the bolus had no carbs, and nothing for a tapped time", async () => {
    api.curve = curveView({ meal: linked({ pumpCarbs: undefined }) });
    const { unmount } = mount();
    await ready();
    expect(screen.getByText("Bolus 11:58 · 2,4 E")).toBeInTheDocument();
    expect(screen.queryByText(/Pumpen/)).toBeNull();
    unmount();
    api.curve = curveView({ meal: mealView({ bolusTs: shift(MEAL_TS, -2) }) });
    mount();
    await ready();
    // The curve still draws the tapped time (CurveCard); the header shows no units for it.
    expect(screen.queryByTestId("meal-bolus")).toBeNull();
    expect(screen.queryByText(/\d E$/)).toBeNull();
  });
  it("says it in English with the unit letter U", async () => {
    api.curve = curveView({ meal: linked() });
    mount({ layout: "desktop" }, "en");
    await ready();
    expect(screen.getByText("Bolus 11:58 · 2.4 U")).toBeInTheDocument();
    expect(screen.getByText("Pump: 45 g")).toBeInTheDocument();
  });
  it.each(["phone", "desktop"] as const)(
    "%s: marks a pump meal 'Fra pumpen · ikke tjekket' with 'Det passer', no lead tile and no observation",
    async (layout) => {
      api.curve = curveView({
        meal: linked({ bolusTs: MEAL_TS, fromPump: true, title: "Kulhydrater fra pumpen" }),
      });
      mount({ layout, aiEnabled: true });
      await ready();
      const badge = screen.getByText("Fra pumpen · ikke tjekket");
      expect(badge).toHaveAttribute("data-variant", "unverified");
      expect(screen.getByRole("button", { name: "Det passer" })).toBeVisible();
      expect(within(screen.getByTestId("meal-tiles")).queryByText(/Bolus/)).toBeNull();
      expect(screen.queryByText(/Observation/)).toBeNull();
      expect(api.calls.some((call) => call.includes("/insight"))).toBe(false);
    },
  );
});

it("uses the typical fixture's 12-minute lead (sanity)", () => {
  expect(TYPICAL.bolusTs).toBe(shift(MEAL_TS, -12).replace(".000Z", "Z"));
});

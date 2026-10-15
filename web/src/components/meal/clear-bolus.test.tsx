import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n/Provider";
import { getMessages } from "@/lib/i18n/messages";
import { fetchFake } from "./test-support";
import { curveView, mealView } from "@/components/meal-detail/test-support";
import { MealDetail } from "@/components/meal-detail/MealDetail";
import { SimpleMealView } from "@/components/meal-detail/SimpleMealView";

const live = vi.hoisted(() => ({
  handlers: new Set<(event: { payload: { mealId: string } }) => void>(),
}));
vi.mock("@/lib/live/useLiveFeed", () => ({
  useLiveFeed: () => ({
    loaded: true,
    readings: [],
    subscribe: (type: string, handler: (event: { payload: { mealId: string } }) => void) => {
      if (type === "meal.updated") live.handlers.add(handler);
      return () => {
        live.handlers.delete(handler);
      };
    },
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  live.handlers.clear();
});

function mount(layout: "phone" | "desktop", locale: "da" | "en" = "da") {
  return render(
    <I18nProvider locale={locale} messages={getMessages(locale)}>
      <MealDetail
        spaceId="s1"
        mealId="m1"
        locale={locale}
        timeZone="Europe/Copenhagen"
        unit="mmol"
        layout={layout}
      />
    </I18nProvider>,
  );
}

describe("clearing a saved meal timestamp", () => {
  it.each(["phone", "desktop"] as const)(
    "%s: clears on Save and drops the curve marker",
    async (layout) => {
      let view = curveView();
      const fake = fetchFake()
        .on("GET /api/spaces/s1/meals/m1/curve", () => view)
        .on("PATCH /api/spaces/s1/meals/m1", () => {
          view = curveView({ meal: mealView({ bolusTs: undefined }) });
          return view.meal;
        });
      fake.install();
      mount(layout);
      await screen.findByTestId("curve-card");
      expect(screen.getByTestId("bolus")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: layout === "phone" ? "Ret" : "Ret E" }));
      const sheet = within(screen.getByRole("dialog"));
      fireEvent.click(sheet.getByRole("button", { name: "Fjern bolustidspunkt" }));
      expect(sheet.queryByRole("button", { name: "Fjern bolustidspunkt" })).toBeNull();
      expect(fake.calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
      fireEvent.click(sheet.getByRole("button", { name: "Gem" }));
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).toBeNull();
      });
      expect(fake.calls.find((c) => c.method === "PATCH")?.body).toHaveProperty("bolusTs", null);
      expect(screen.queryByTestId("bolus")).toBeNull();
    },
  );

  it("keeps removal out of the simpleMode meal view", async () => {
    fetchFake().on("GET /api/spaces/s1/meals/m1", mealView()).install();
    render(
      <I18nProvider locale="da" messages={getMessages("da")}>
        <SimpleMealView spaceId="s1" mealId="m1" locale="da" timeZone="Europe/Copenhagen" />
      </I18nProvider>,
    );
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("button", { name: /Fjern bolustidspunkt|Ret/ })).toBeNull();
    expect(screen.queryByTestId("bolus-done")).toBeNull();
  });

  it("drops the marker when another device clears the time and emits meal.updated", async () => {
    let view = curveView();
    fetchFake()
      .on("GET /api/spaces/s1/meals/m1/curve", () => view)
      .install();
    mount("phone");
    await screen.findByTestId("curve-card");
    expect(screen.getByTestId("bolus")).toBeInTheDocument();
    view = curveView({ meal: mealView({ bolusTs: undefined }) });
    act(() => {
      for (const handler of live.handlers) handler({ payload: { mealId: "m1" } });
    });
    await waitFor(() => {
      expect(screen.queryByTestId("bolus")).toBeNull();
    });
  });

  it.each(["da", "en"] as const)("%s: offers removal only with a saved time", async (locale) => {
    const fake = fetchFake().on("GET /api/spaces/s1/meals/m1/curve", curveView());
    fake.install();
    mount("phone", locale);
    fireEvent.click(await screen.findByRole("button", { name: locale === "da" ? "Ret" : "Edit" }));
    expect(
      screen.getByRole("button", {
        name: locale === "da" ? "Fjern bolustidspunkt" : "Remove bolus time",
      }),
    ).toBeVisible();
    cleanup();
    fake.on(
      "GET /api/spaces/s1/meals/m1/curve",
      curveView({ meal: mealView({ bolusTs: undefined }) }),
    );
    mount("phone", locale);
    fireEvent.click(await screen.findByRole("button", { name: locale === "da" ? "Ret" : "Edit" }));
    expect(
      screen.queryByRole("button", { name: /Fjern bolustidspunkt|Remove bolus time/ }),
    ).toBeNull();
  });
});

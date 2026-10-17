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

// Issue #215: nobody taps or clears the bolus time by hand any more; a pump import fills it later.
// A stored time stays on the curve and survives an edit untouched.
describe("a stored bolus time on meal detail", () => {
  it.each(["phone", "desktop"] as const)(
    "%s: the edit sheet has no bolus control, and saving an edit keeps the stored time",
    async (layout) => {
      const view = curveView();
      const fake = fetchFake()
        .on("GET /api/spaces/s1/meals/m1/curve", () => view)
        .on("PATCH /api/spaces/s1/meals/m1", () => view.meal);
      fake.install();
      mount(layout);
      await screen.findByTestId("curve-card");
      expect(screen.getByTestId("bolus")).toBeInTheDocument();
      fireEvent.click(
        screen.getByRole("button", { name: layout === "phone" ? "Ret måltid" : "Ret E" }),
      );
      const dialog = screen.getByRole("dialog");
      expect(within(dialog).queryByRole("button", { name: /bolus|fortryd/i })).toBeNull();
      expect(dialog.textContent).not.toMatch(/bolus|insulin/i);
      fireEvent.click(within(dialog).getByRole("button", { name: "Gem" }));
      await waitFor(
        () => {
          expect(screen.queryByRole("dialog")).toBeNull();
        },
        { timeout: 3000 },
      );
      expect(fake.calls.find((c) => c.method === "PATCH")?.body).not.toHaveProperty("bolusTs");
      expect(screen.getByTestId("bolus")).toBeInTheDocument();
    },
  );

  it("keeps the edit out of the simpleMode meal view", async () => {
    fetchFake().on("GET /api/spaces/s1/meals/m1", mealView()).install();
    render(
      <I18nProvider locale="da" messages={getMessages("da")}>
        <SimpleMealView spaceId="s1" mealId="m1" locale="da" timeZone="Europe/Copenhagen" />
      </I18nProvider>,
    );
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("button", { name: /bolus|Ret/i })).toBeNull();
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

  it.each(["da", "en"] as const)(
    "%s: offers no bolus control in the edit sheet, with or without a stored time",
    async (locale) => {
      const fake = fetchFake().on("GET /api/spaces/s1/meals/m1/curve", curveView());
      fake.install();
      const editLabel = locale === "da" ? "Ret måltid" : "Edit meal";
      mount("phone", locale);
      fireEvent.click(await screen.findByRole("button", { name: editLabel }));
      expect(screen.getByRole("dialog").textContent).not.toMatch(/bolus/i);
      cleanup();
      fake.on(
        "GET /api/spaces/s1/meals/m1/curve",
        curveView({ meal: mealView({ bolusTs: undefined }) }),
      );
      mount("phone", locale);
      fireEvent.click(await screen.findByRole("button", { name: editLabel }));
      expect(screen.getByRole("dialog").textContent).not.toMatch(/bolus/i);
    },
  );
});

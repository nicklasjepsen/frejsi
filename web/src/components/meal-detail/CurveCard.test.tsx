import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { I18nProvider } from "@/lib/i18n/Provider";
import { getMessages } from "@/lib/i18n/messages";

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

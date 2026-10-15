import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { I18nProvider } from "@/lib/i18n/Provider";
import { getMessages } from "@/lib/i18n/messages";
import type { AppLocale } from "@/lib/i18n/routing";

import { SoonPage } from "./SoonPage";
import { SOON_FEATURES, isSoonFeature } from "./soon-features";

const mount = (ui: React.ReactElement, locale: AppLocale = "da") =>
  render(
    <I18nProvider locale={locale} messages={getMessages(locale)}>
      {ui}
    </I18nProvider>,
  );

afterEach(cleanup);

describe("SoonPage (decision 15, 16)", () => {
  it("knows the unbuilt features the navigation links to", () => {
    expect([...SOON_FEATURES]).toEqual([
      "meals",
      "food",
      "history",
      "my-food",
      "ask",
      "today",
      "earlier-days",
    ]);
    expect(isSoonFeature("meals")).toBe(true);
    expect(isSoonFeature("glucose")).toBe(false);
  });

  it("renders the calm placeholder with the feature's name and a way back", () => {
    mount(<SoonPage locale="da" feature="meals" role="owner" />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Kommer i en senere version",
    );
    expect(screen.getByText("Måltider")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Tilbage til Nu" })).toHaveAttribute("href", "/da/now");
  });

  it("renders without a feature too", () => {
    mount(<SoonPage locale="en" feature={null} role="carer" />, "en");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Coming in a later version",
    );
    expect(
      screen.getByText("This part of Frejsi isn't ready yet. Everything else works as it should."),
    ).toBeInTheDocument();
  });

  it("gives a viewer the I dag page: the notice that blood sugar is not shown and the meals placeholder, no link to Nu", () => {
    const { container } = mount(<SoonPage locale="da" feature="today" role="viewer" />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("I dag");
    expect(screen.getByText(/Blodsukker vises ikke her/)).toBeInTheDocument();
    expect(screen.getByText("Måltider kommer i en senere version.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Tilbage til Nu" })).toBeNull();
    expect(container.textContent).not.toMatch(/mmol/);
  });
});

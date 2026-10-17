import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { I18nProvider } from "@/lib/i18n/Provider";
import { getMessages } from "@/lib/i18n/messages";

import { SaveAsRecipe } from "./SaveAsRecipe";

afterEach(cleanup);

describe("SaveAsRecipe (Gem som opskrift)", () => {
  it.each(["da", "en"] as const)(
    "%s: a link that opens the recipe form with the meal, and saves nothing itself",
    (locale) => {
      render(
        <I18nProvider locale={locale} messages={getMessages(locale)}>
          <SaveAsRecipe meal={{ id: "meal/1" }} locale={locale} />
        </I18nProvider>,
      );
      const link = screen.getByRole("link", {
        name: locale === "da" ? "Gem som opskrift" : "Save as recipe",
      });
      expect(link).toHaveAttribute("href", `/${locale}/recipe/new?meal=meal%2F1`);
    },
  );
});

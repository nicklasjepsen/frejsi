import "@testing-library/jest-dom/vitest";
import type { LookupResponse } from "@frejsi/shared/schemas/food";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import da from "../../../messages/da";
import en from "../../../messages/en";
import { LookupResults } from "./LookupResults";

afterEach(cleanup);

const empty: LookupResponse = { results: [], sources: {}, manual: { name: "lasagne" } };

describe("LookupResults: the manual path's way to a recipe (v0.6.0 §6)", () => {
  it.each(["da", "en"] as const)(
    "%s: shows Fra opskrift after Jeg kender tallet selv, linking to /recipe/new",
    (locale) => {
      render(
        <NextIntlClientProvider locale={locale} messages={locale === "da" ? da : en}>
          <LookupResults response={empty} query="lasagne" onPick={vi.fn()} onManual={vi.fn()} />
        </NextIntlClientProvider>,
      );
      const rows = screen.getAllByRole("listitem");
      expect(rows).toHaveLength(2);
      expect(rows[0]).toHaveTextContent(
        locale === "da" ? "Jeg kender tallet selv" : "I know the number myself",
      );
      const link = screen.getByTestId("from-recipe");
      expect(link).toHaveAttribute("href", `/${locale}/recipe/new`);
      expect(link).toHaveTextContent(locale === "da" ? "Fra opskrift" : "From a recipe");
    },
  );
});

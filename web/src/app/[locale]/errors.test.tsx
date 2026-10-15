import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/lib/i18n/Provider";
import { getMessages } from "@/lib/i18n/messages";
import type { AppLocale } from "@/lib/i18n/routing";

const navigation = vi.hoisted(() => ({ pathname: "/da/now" }));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname }));

import GlobalError from "../global-error";
import LocaleError from "./error";
import LocaleNotFound from "./not-found";

const SECRET = "Example Person's token is abc123 at /secret/route.ts:12";

const mount = (ui: React.ReactElement, locale: AppLocale) =>
  render(
    <I18nProvider locale={locale} messages={getMessages(locale)}>
      {ui}
    </I18nProvider>,
  );

afterEach(() => {
  cleanup();
  navigation.pathname = "/da/now";
});

describe("error pages (plan §9)", () => {
  it("error.tsx renders kind copy in the user's language, no technical detail, and can retry", () => {
    const reset = vi.fn();
    navigation.pathname = "/en/now";
    const { container } = mount(<LocaleError error={new Error(SECRET)} reset={reset} />, "en");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Something went wrong");
    expect(container.textContent).not.toContain("abc123");
    expect(container.textContent).not.toContain("route.ts");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "To the front page" })).toHaveAttribute("href", "/en");
  });

  it("error.tsx speaks Danish on a Danish path", () => {
    mount(<LocaleError error={new Error(SECRET)} reset={vi.fn()} />, "da");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Noget gik galt");
    expect(screen.getByRole("link", { name: "Til forsiden" })).toHaveAttribute("href", "/da");
  });

  it("not-found.tsx renders the kind page with a way home", () => {
    mount(<LocaleNotFound />, "da");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Den side findes ikke");
    expect(screen.getByRole("link", { name: "Til forsiden" })).toHaveAttribute("href", "/da");
  });

  it("global-error.tsx works without a provider, picks the locale from the URL and shows nothing technical", () => {
    window.history.pushState({}, "", "/en/now");
    const reset = vi.fn();
    // Rendered into a div: jsdom cannot nest an <html> inside the document body, so check the text.
    const { container } = render(<GlobalError error={new Error(SECRET)} reset={reset} />);
    expect(container.textContent).toContain("Something went wrong");
    expect(container.textContent).not.toContain("abc123");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalled();
    window.history.pushState({}, "", "/");
  });
});

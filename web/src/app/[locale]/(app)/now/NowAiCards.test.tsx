import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { I18nProvider } from "@/lib/i18n/Provider";
import { getMessages } from "@/lib/i18n/messages";
import { NowAiCards } from "./NowAiCards";

afterEach(cleanup);
it.each(["da", "en"] as const)("renders translated ready and off states in %s", (locale) => {
  const messages = getMessages(locale);
  const view = render(
    <I18nProvider locale={locale} messages={messages}>
      <NowAiCards locale={locale} ai={{ enabled: true, provider: "anthropic", ready: true }} />
    </I18nProvider>,
  );
  const link = screen.getByRole("link", { name: new RegExp(messages.now.weekTitle) });
  expect(link).toHaveAttribute("href", `/${locale}/history/week#opsummering`);
  expect(link).toHaveTextContent(messages.now.weekReady);
  view.rerender(
    <I18nProvider locale={locale} messages={messages}>
      <NowAiCards locale={locale} ai={{ enabled: false, provider: null, ready: false }} />
    </I18nProvider>,
  );
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  expect(screen.getByText(messages.now.aiOff)).toBeInTheDocument();
});

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/lib/i18n/Provider";
import { getMessages } from "@/lib/i18n/messages";
import type { AppLocale } from "@/lib/i18n/routing";

import type { SourceView } from "./contracts";
import { SourcePicker } from "./SourcePicker";
import { settingsApi } from "./settings-client";

const navigation = vi.hoisted(() => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  usePathname: () => "/da/settings/source",
}));

const NOW = "2026-10-15T14:00:00.000Z";
const source: SourceView = {
  type: "dexcom-share",
  region: "eu",
  status: "connected",
  lastReadingAt: "2026-10-15T13:13:00.000Z",
  since: null,
};
const settings = {
  aiEnabled: false,
  name: "Almas rum",
  timezone: "Europe/Copenhagen",
  glucoseUnit: "mmol",
  targetLow: 4,
  targetHigh: 10,
  sourceType: "manual",
  sourceStatus: "connected",
  lastReadingAt: null,
};

function mount(locale: AppLocale = "da", fetchImpl?: typeof fetch) {
  return render(
    <I18nProvider locale={locale} messages={getMessages(locale)} timeZone="Europe/Copenhagen">
      <SourcePicker
        locale={locale}
        spaceId="s1"
        source={source}
        timezone="Europe/Copenhagen"
        now={NOW}
        {...(fetchImpl ? { api: settingsApi(fetchImpl) } : {})}
      />
    </I18nProvider>,
  );
}

beforeEach(() => {
  navigation.push.mockClear();
  navigation.refresh.mockClear();
});
afterEach(cleanup);

describe("SourcePicker (settings/source, phone; design gap derived from the desktop cards)", () => {
  it("has the 44 px back link, the three cards at phone size and the vault notice", () => {
    mount();
    expect(screen.getByRole("link", { name: "Tilbage" })).toHaveAttribute("href", "/da/settings");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Glukosekilde");
    const page = within(screen.getByTestId("source-picker"));
    expect(page.getByTestId("source-card")).toHaveTextContent("Dexcom Share");
    expect(page.getByTestId("source-card-nightscout")).toHaveAttribute("data-layout", "radio");
    expect(page.getByTestId("source-card-manual")).toBeInTheDocument();
    expect(page.getByText(/Login til Dexcom Share gemmes i et låst hvælv/)).toBeInTheDocument();
  });

  it("confirms, writes Manuelt and goes back to Settings", async () => {
    const calls: unknown[] = [];
    const fetchImpl = vi.fn((_url: string, init: RequestInit = {}) => {
      calls.push(JSON.parse(init.body as string));
      return Promise.resolve(Response.json(settings));
    });
    mount("da", fetchImpl as unknown as typeof fetch);
    fireEvent.click(screen.getByRole("button", { name: "Vælg" }));
    expect(screen.getByTestId("manual-confirm")).toHaveTextContent(
      "Skift til manuelle målinger? Frejsi henter så ikke længere fra Dexcom Share.",
    );
    expect(calls).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Skift til manuelt" }));
    await waitFor(() => {
      expect(navigation.push).toHaveBeenCalledWith("/da/settings");
    });
    expect(calls).toEqual([{ type: "manual" }]);
  });

  it("speaks English", () => {
    mount("en");
    expect(screen.getByTestId("source-card-manual")).toHaveTextContent(
      "Finger-prick readings typed in. No sensor.",
    );
  });
});

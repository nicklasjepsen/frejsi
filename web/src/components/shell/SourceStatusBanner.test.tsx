import "@testing-library/jest-dom/vitest";

import { readFileSync } from "node:fs";
import path from "node:path";

import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { I18nProvider } from "@/lib/i18n/Provider";
import { getMessages } from "@/lib/i18n/messages";
import type { AppLocale } from "@/lib/i18n/routing";

import { SourceStatusBanner } from "./SourceStatusBanner";

const wrap = (locale: AppLocale, ui: ReactNode) =>
  render(
    <I18nProvider locale={locale} messages={getMessages(locale)} timeZone="Europe/Copenhagen">
      {ui}
    </I18nProvider>,
  );

afterEach(cleanup);

describe("SourceStatusBanner (plan §9, decision 20)", () => {
  it("renders nothing while connected, and nothing before a source is configured", () => {
    const { container } = wrap(
      "da",
      <>
        <SourceStatusBanner
          status="connected"
          since={null}
          sourceType="dexcom-share"
          timeZone="Europe/Copenhagen"
        />
        <SourceStatusBanner
          status="not-configured"
          since={null}
          sourceType={null}
          timeZone="Europe/Copenhagen"
        />
      </>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("names the source from the message key for its type and shows the time since", () => {
    wrap(
      "da",
      <SourceStatusBanner
        status="disconnected"
        since="2026-10-14T12:05:00.000Z"
        sourceType="dexcom-share"
        timeZone="Europe/Copenhagen"
      />,
    );
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("Ingen forbindelse til Dexcom Share siden 14:05");
  });

  it("formats the time in the space's zone, not the runtime's or the provider's", () => {
    wrap(
      "da",
      <SourceStatusBanner
        status="disconnected"
        since="2026-10-14T12:05:00.000Z"
        sourceType="dexcom-share"
        timeZone="America/New_York"
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("siden 08:05");
  });

  it("says only that there is no connection when the time of the disconnection is unknown", () => {
    wrap(
      "da",
      <SourceStatusBanner
        status="disconnected"
        since={null}
        sourceType="dexcom-share"
        timeZone="Europe/Copenhagen"
      />,
    );
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("Ingen forbindelse til Dexcom Share");
    expect(banner.textContent).not.toMatch(/siden|–/);
  });

  it("speaks English for an English user", () => {
    wrap(
      "en",
      <SourceStatusBanner
        status="disconnected"
        since="2026-10-14T12:05:00.000Z"
        sourceType="dexcom-share"
        timeZone="Europe/Copenhagen"
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "No connection to Dexcom Share since 14:05",
    );
  });

  it("does not know Dexcom: the only source-specific text is the message for the type", () => {
    const source = readFileSync(path.join(import.meta.dirname, "SourceStatusBanner.tsx"), "utf8");
    expect(source).not.toMatch(/dexcom/i);
  });
});

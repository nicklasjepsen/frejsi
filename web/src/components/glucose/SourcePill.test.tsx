import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { I18nProvider } from "@/lib/i18n/Provider";
import { getMessages } from "@/lib/i18n/messages";
import type { AppLocale } from "@/lib/i18n/routing";

import { SourcePill } from "./SourcePill";

const T0 = new Date("2026-10-14T13:13:00.000Z");
const minutesAgo = (m: number) => new Date(T0.getTime() - m * 60_000).toISOString();
const latest = (m: number) => ({ ts: minutesAgo(m), mmol: 6.2, trend: "flat" as const });

const wrap = (ui: ReactNode, locale: AppLocale = "da") =>
  render(
    <I18nProvider locale={locale} messages={getMessages(locale)}>
      {ui}
    </I18nProvider>,
  );

afterEach(cleanup);

describe("SourcePill", () => {
  it("says '{source} forbundet' in the phone header with the accent dot", () => {
    wrap(
      <SourcePill
        status="connected"
        sourceType="dexcom-share"
        latest={latest(3)}
        now={T0}
        timeZone="Europe/Copenhagen"
        variant="pill"
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Dexcom Share forbundet");
    expect(screen.getByTestId("source-dot")).not.toHaveAttribute("data-muted");
  });

  it("says '{source} · sidste måling 15:10' on desktop in the space's zone", () => {
    wrap(
      <SourcePill
        status="connected"
        sourceType="dexcom-share"
        latest={latest(3)}
        now={T0}
        timeZone="Europe/Copenhagen"
        variant="line"
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Dexcom Share · sidste måling 15:10");
  });

  it("turns the dot muted after 15 minutes without a reading, and before the first one", () => {
    const { rerender } = wrap(
      <SourcePill
        status="connected"
        sourceType="dexcom-share"
        latest={latest(15)}
        now={T0}
        timeZone="Europe/Copenhagen"
        variant="pill"
      />,
    );
    expect(screen.getByTestId("source-dot")).toHaveAttribute("data-muted", "true");
    rerender(
      <I18nProvider locale="da" messages={getMessages("da")}>
        <SourcePill
          status="connected"
          sourceType="dexcom-share"
          latest={null}
          now={T0}
          timeZone="Europe/Copenhagen"
          variant="line"
        />
      </I18nProvider>,
    );
    expect(screen.getByTestId("source-dot")).toHaveAttribute("data-muted", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Dexcom Share · ingen måling endnu");
  });

  it("renders nothing while disconnected (the banner speaks) and a muted note without a source", () => {
    const { container } = wrap(
      <SourcePill
        status="disconnected"
        sourceType="dexcom-share"
        latest={latest(3)}
        now={T0}
        timeZone="Europe/Copenhagen"
        variant="pill"
      />,
    );
    expect(container).toBeEmptyDOMElement();
    wrap(
      <SourcePill
        status="not-configured"
        sourceType={null}
        latest={null}
        now={T0}
        timeZone="Europe/Copenhagen"
        variant="pill"
      />,
      "en",
    );
    expect(screen.getByRole("status")).toHaveTextContent("No glucose source chosen yet");
    expect(screen.getByTestId("source-dot")).toHaveAttribute("data-muted", "true");
  });
  it("says 'Manuelt' in the pill and 'Manuelt · sidste måling 15:10' on the line, never 'forbundet'", () => {
    for (const status of ["connected", "not-configured"] as const) {
      const pill = wrap(
        <SourcePill
          status={status}
          sourceType="manual"
          latest={latest(3)}
          now={T0}
          timeZone="Europe/Copenhagen"
          variant="pill"
        />,
      );
      expect(screen.getByRole("status")).toHaveTextContent(/^Manuelt$/);
      pill.unmount();
      const line = wrap(
        <SourcePill
          status={status}
          sourceType="manual"
          latest={latest(3)}
          now={T0}
          timeZone="Europe/Copenhagen"
          variant="line"
        />,
      );
      expect(screen.getByRole("status")).toHaveTextContent("Manuelt · sidste måling 15:10");
      line.unmount();
    }
  });

  it("carries a short wording for narrow phone headers beside the full text", () => {
    wrap(
      <SourcePill
        status="connected"
        sourceType="dexcom-share"
        latest={latest(3)}
        now={T0}
        timeZone="Europe/Copenhagen"
        variant="pill"
      />,
    );
    const status = screen.getByRole("status");
    // The full text stays for assistive technology; the short one is decoration under 400 px.
    expect(within(status).getByText("Dexcom Share forbundet")).toHaveAttribute("data-part", "full");
    const short = within(status).getByText("forbundet");
    expect(short).toHaveAttribute("data-part", "short");
    expect(short).toHaveAttribute("aria-hidden", "true");
    cleanup();
    wrap(
      <SourcePill
        status="not-configured"
        sourceType={null}
        latest={null}
        now={T0}
        timeZone="Europe/Copenhagen"
        variant="pill"
      />,
      "en",
    );
    expect(within(screen.getByRole("status")).getByText("No source")).toHaveAttribute(
      "data-part",
      "short",
    );
    cleanup();
    // "Manuelt" is short already, and the desktop line never shortens.
    wrap(
      <SourcePill
        status="connected"
        sourceType="manual"
        latest={latest(3)}
        now={T0}
        timeZone="Europe/Copenhagen"
        variant="pill"
      />,
    );
    expect(screen.getByRole("status").querySelector('[data-part="short"]')).toBeNull();
  });

  it("mutes the dot when the last finger-prick is older than 15 minutes", () => {
    wrap(
      <SourcePill
        status="connected"
        sourceType="manual"
        latest={latest(40)}
        now={T0}
        timeZone="Europe/Copenhagen"
        variant="pill"
      />,
    );
    expect(screen.getByTestId("source-dot")).toHaveAttribute("data-muted", "true");
  });
});

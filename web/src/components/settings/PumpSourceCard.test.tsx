import "@testing-library/jest-dom/vitest";

import type { PumpSettingsView } from "@frejsi/shared";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/lib/i18n/Provider";
import { getMessages } from "@/lib/i18n/messages";
import type { AppLocale } from "@/lib/i18n/routing";

import { PumpSourceCard } from "./PumpSourceCard";
import { pumpSourceApi, type PumpSourceApi } from "./pump-source-client";

const navigation = vi.hoisted(() => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  usePathname: () => "/da/settings",
}));

// 13:08 in Copenhagen (summer time, UTC+2).
const NOW = "2026-10-15T11:08:00.000Z";
const notConfigured: PumpSettingsView = { status: "not-configured", configured: false };
const connected: PumpSettingsView = {
  status: "connected",
  since: "2026-10-15T06:00:00.000Z",
  lastPumpAt: "2026-10-15T09:58:00.000Z",
  configured: true,
};
const disconnected: PumpSettingsView = {
  status: "disconnected",
  since: "2026-10-15T12:05:00.000Z",
  lastPumpAt: "2026-10-15T09:58:00.000Z",
  configured: true,
};

function fakeApi(answers: Record<string, () => Response>) {
  const calls: { method: string; body: unknown }[] = [];
  const fetchImpl = vi.fn((_url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    calls.push({ method, body: init.body ? JSON.parse(init.body as string) : undefined });
    const answer = answers[method];
    return Promise.resolve(answer ? answer() : new Response(null, { status: 500 }));
  });
  return { api: pumpSourceApi(fetchImpl as unknown as typeof fetch), calls };
}

function mount(
  pump: PumpSettingsView,
  {
    owner = true,
    locale = "da",
    api = fakeApi({}).api,
    now = NOW,
  }: { owner?: boolean; locale?: AppLocale; api?: PumpSourceApi; now?: string } = {},
) {
  return render(
    <I18nProvider locale={locale} messages={getMessages(locale)} timeZone="Europe/Copenhagen">
      <PumpSourceCard
        locale={locale}
        spaceId="s1"
        pump={pump}
        timezone="Europe/Copenhagen"
        now={now}
        owner={owner}
        api={api}
      />
    </I18nProvider>,
  );
}

const card = () => screen.getByTestId("pump-card");
const submitForm = () => {
  const form = screen.getByTestId("pump-form");
  fireEvent.change(within(form).getByLabelText("Adresse på din Nightscout-side"), {
    target: { value: "https://nightscout.example.test" },
  });
  const secret = form.querySelector<HTMLInputElement>('input[name="secret"]');
  if (!secret) throw new Error("no secret field");
  fireEvent.change(secret, { target: { value: "example-token" } });
  fireEvent.click(within(form).getByRole("button", { name: "Forbind" }));
};

beforeEach(() => {
  navigation.refresh.mockClear();
});
afterEach(cleanup);

describe("PumpSourceCard · Pumpehistorik (plan §9 item 5)", () => {
  it("shows Ikke forbundet and Forbind to an owner before the pump record is connected", () => {
    mount(notConfigured);
    expect(within(card()).getByRole("heading", { name: "Pumpehistorik" })).toBeVisible();
    expect(screen.getByTestId("pump-status")).toHaveTextContent("Ikke forbundet");
    expect(screen.queryByTestId("pump-latest")).toBeNull();
    expect(within(card()).getByRole("button", { name: "Forbind" })).toBeVisible();
    expect(screen.queryByTestId("pump-form")).toBeNull();
  });

  it("shows the status and the newest record with its time and age when connected", () => {
    mount(connected);
    expect(screen.getByTestId("pump-status")).toHaveTextContent("Forbundet");
    expect(screen.getByTestId("pump-latest")).toHaveTextContent(
      "Senest fra pumpen: 11:58 · for 1 t 10 min siden",
    );
    expect(card()).toHaveTextContent("op til en times forsinkelse");
    expect(within(card()).getByRole("button", { name: "Skift adgang" })).toBeVisible();
    expect(within(card()).getByRole("button", { name: "Afbryd" })).toBeVisible();
  });

  it("writes the age in whole hours, minutes and just now, and names another day's date", () => {
    mount(connected, { now: "2026-10-15T11:58:00.000Z" });
    expect(screen.getByTestId("pump-latest")).toHaveTextContent("11:58 · for 2 t siden");
    cleanup();
    mount(connected, { now: "2026-10-15T10:20:00.000Z" });
    expect(screen.getByTestId("pump-latest")).toHaveTextContent("11:58 · for 22 min siden");
    cleanup();
    mount(connected, { now: "2026-10-15T09:58:20.000Z" });
    expect(screen.getByTestId("pump-latest")).toHaveTextContent("11:58 · lige nu");
    cleanup();
    mount(connected, { now: "2026-10-17T09:00:00.000Z" });
    expect(screen.getByTestId("pump-latest")).toHaveTextContent(
      "Senest fra pumpen: 15. okt. 11:58 · for mere end et døgn siden",
    );
  });

  it("says Intet fra pumpen endnu when connected without a record yet", () => {
    mount({ status: "connected", configured: true });
    expect(screen.getByTestId("pump-latest")).toHaveTextContent("Intet fra pumpen endnu");
  });

  it("says since when the connection has been failing, and keeps the newest record", () => {
    mount(disconnected);
    expect(screen.getByTestId("pump-status")).toHaveTextContent("Forbindelsen svigter siden 14:05");
    expect(screen.getByTestId("pump-latest")).toHaveTextContent("Senest fra pumpen: 11:58");
    cleanup();
    const { since: _since, ...withoutSince } = disconnected;
    mount(withoutSince);
    expect(screen.getByTestId("pump-status")).toHaveTextContent(/^Forbindelsen svigter$/);
  });

  it("connects through the form, then shows the new status and refreshes the page", async () => {
    const { api, calls } = fakeApi({
      POST: () =>
        Response.json({ status: "connected", since: NOW, configured: true, recentBoluses: 5 }),
    });
    mount(notConfigured, { api });
    fireEvent.click(within(card()).getByRole("button", { name: "Forbind" }));
    submitForm();
    await waitFor(() => {
      expect(screen.getByTestId("pump-status")).toHaveTextContent("Forbundet");
    });
    expect(screen.getByTestId("pump-latest")).toHaveTextContent("Intet fra pumpen endnu");
    expect(screen.queryByTestId("pump-form")).toBeNull();
    expect(screen.queryByTestId("pump-no-recent")).toBeNull();
    expect(calls.map((c) => c.method)).toEqual(["POST"]);
    expect(navigation.refresh).toHaveBeenCalled();
  });

  it("warns when the access works but the pump sent nothing in the last day", async () => {
    const { api } = fakeApi({
      POST: () =>
        Response.json({ status: "connected", since: NOW, configured: true, recentBoluses: 0 }),
    });
    mount(notConfigured, { api });
    fireEvent.click(within(card()).getByRole("button", { name: "Forbind" }));
    submitForm();
    expect(await screen.findByTestId("pump-no-recent")).toHaveTextContent(
      "Adgangen virker, men pumpen har ikke sendt noget det sidste døgn.",
    );
    expect(screen.getByTestId("pump-status")).toHaveTextContent("Forbundet");
  });

  it("disconnects after asking, and shows Ikke forbundet again", async () => {
    const { api, calls } = fakeApi({
      DELETE: () => Response.json({ status: "not-configured", since: NOW, configured: false }),
    });
    mount(connected, { api });
    fireEvent.click(within(card()).getByRole("button", { name: "Afbryd" }));
    const ask = screen.getByRole("alertdialog");
    expect(ask).toHaveTextContent("Det, der allerede er hentet, bliver liggende.");
    fireEvent.click(within(ask).getByRole("button", { name: "Ja, afbryd" }));
    await waitFor(() => {
      expect(screen.getByTestId("pump-status")).toHaveTextContent("Ikke forbundet");
    });
    expect(calls.map((c) => c.method)).toEqual(["DELETE"]);
    expect(within(card()).getByRole("button", { name: "Forbind" })).toBeVisible();
  });

  it("shows a refused disconnect in the error copy", async () => {
    const { api } = fakeApi({
      DELETE: () =>
        Response.json({ error: { code: "forbidden", message: "forbidden" } }, { status: 403 }),
    });
    mount(connected, { api });
    fireEvent.click(within(card()).getByRole("button", { name: "Afbryd" }));
    fireEvent.click(screen.getByRole("button", { name: "Ja, afbryd" }));
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(screen.getByTestId("pump-status")).toHaveTextContent("Forbundet");
  });

  it("shows a carer the status without the form or a button", () => {
    mount(connected, { owner: false });
    expect(screen.getByTestId("pump-status")).toHaveTextContent("Forbundet");
    expect(screen.getByTestId("pump-latest")).toHaveTextContent("Senest fra pumpen: 11:58");
    expect(within(card()).queryAllByRole("button")).toEqual([]);
    expect(within(card()).queryAllByRole("link")).toEqual([]);
    cleanup();
    mount(notConfigured, { owner: false });
    expect(screen.getByTestId("pump-status")).toHaveTextContent("Ikke forbundet");
    expect(within(card()).queryAllByRole("button")).toEqual([]);
  });

  it("reads the same in English", () => {
    mount(connected, { locale: "en" });
    expect(within(card()).getByRole("heading", { name: "Pump history" })).toBeVisible();
    expect(screen.getByTestId("pump-latest")).toHaveTextContent(
      "Latest from the pump: 11:58 · 1 h 10 min ago",
    );
    cleanup();
    mount(disconnected, { locale: "en" });
    expect(screen.getByTestId("pump-status")).toHaveTextContent("Connection failing since 14:05");
  });

  it("keeps the age growing while Settings stays open", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(NOW));
      mount(connected);
      expect(screen.getByTestId("pump-latest")).toHaveTextContent("for 1 t 10 min siden");
      act(() => {
        vi.setSystemTime(new Date("2026-10-15T11:20:00.000Z"));
        vi.advanceTimersByTime(30_000);
      });
      expect(screen.getByTestId("pump-latest")).toHaveTextContent("for 1 t 22 min siden");
    } finally {
      vi.useRealTimers();
    }
  });
});

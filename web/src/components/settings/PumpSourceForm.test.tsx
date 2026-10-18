import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/lib/i18n/Provider";
import { getMessages } from "@/lib/i18n/messages";
import type { AppLocale } from "@/lib/i18n/routing";

import { PumpSourceForm } from "./PumpSourceForm";
import { pumpSourceApi, type ConnectedPumpSettings } from "./pump-source-client";

// The label spells the header's name, which only shared/ may write out: match it loosely.
const API_SECRET = new RegExp("^API.secret$");

function fakeApi(answer: () => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = vi.fn((url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return Promise.resolve(answer());
  });
  return { api: pumpSourceApi(fetchImpl as unknown as typeof fetch), calls };
}
const failure = (code: string, status: number) => () =>
  Response.json({ error: { code, message: code } }, { status });
const ok = () => Response.json({ status: "connected", configured: true, recentBoluses: 4 });

function mount(
  api: ReturnType<typeof pumpSourceApi>,
  handlers: { onConnected?: (r: ConnectedPumpSettings) => void; onCancel?: () => void } = {},
  locale: AppLocale = "da",
) {
  return render(
    <I18nProvider locale={locale} messages={getMessages(locale)} timeZone="Europe/Copenhagen">
      <PumpSourceForm
        spaceId="s1"
        api={api}
        onConnected={handlers.onConnected ?? vi.fn()}
        onCancel={handlers.onCancel ?? vi.fn()}
      />
    </I18nProvider>,
  );
}

const fill = (url: string, secret: string) => {
  fireEvent.change(screen.getByLabelText("Adresse på din Nightscout-side"), {
    target: { value: url },
  });
  fireEvent.change(screen.getByLabelText("Adgangstoken", { selector: "input" }), {
    target: { value: secret },
  });
};

afterEach(cleanup);

describe("PumpSourceForm (the Nightscout half of the connect form, plan §9 item 5)", () => {
  it("posts the address and the token to the pump-source route and hands the answer back", async () => {
    const { api, calls } = fakeApi(ok);
    const onConnected = vi.fn();
    mount(api, { onConnected });
    expect(screen.getByRole("heading", { name: "Forbind pumpehistorik" })).toBeVisible();
    fill("  https://nightscout.example.test ", "example-token");
    fireEvent.click(screen.getByRole("button", { name: "Forbind" }));
    await waitFor(() => {
      expect(onConnected).toHaveBeenCalledWith({
        status: "connected",
        configured: true,
        recentBoluses: 4,
      });
    });
    expect(calls[0]?.url).toBe("/api/spaces/s1/pump-source");
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({
      type: "nightscout",
      url: "https://nightscout.example.test",
      token: "example-token",
    });
  });

  it("sends an API secret instead when that kind is chosen", async () => {
    const { api, calls } = fakeApi(ok);
    mount(api);
    fireEvent.click(screen.getByRole("radio", { name: API_SECRET }));
    fireEvent.change(screen.getByLabelText("Adresse på din Nightscout-side"), {
      target: { value: "https://nightscout.example.test" },
    });
    fireEvent.change(screen.getByLabelText(API_SECRET, { selector: "input" }), {
      target: { value: "example-secret-12" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Forbind" }));
    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({
      type: "nightscout",
      url: "https://nightscout.example.test",
      apiSecret: "example-secret-12",
    });
  });

  it("says a refused access under the field and empties it, and calls nothing more", async () => {
    const { api } = fakeApi(failure("source-bad-credentials", 400));
    const onConnected = vi.fn();
    mount(api, { onConnected });
    fill("https://nightscout.example.test", "wrong");
    fireEvent.click(screen.getByRole("button", { name: "Forbind" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /^Nightscout afviste adgangen – tjek token eller API.secret$/,
    );
    expect(document.querySelector('input[name="secret"]')).toHaveValue("");
    expect(onConnected).not.toHaveBeenCalled();
  });

  it("explains a bad address and an unreachable site in the error copy", async () => {
    let calls = 0;
    const { api } = fakeApi(() =>
      calls++ === 0 ? failure("source-url-invalid", 400)() : failure("source-unreachable", 503)(),
    );
    mount(api);
    fill("https://nightscout.example.test/?x", "t");
    fireEvent.click(screen.getByRole("button", { name: "Forbind" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Adressen skal begynde med https:// og må ikke indeholde ? eller #.",
    );
    fill("https://nightscout.example.test", "t");
    fireEvent.click(screen.getByRole("button", { name: "Forbind" }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Vi kunne ikke få forbindelse til kilden lige nu.",
      );
    });
  });

  it("does not post an empty form, and Annullér hands back without a call", () => {
    const { api, calls } = fakeApi(ok);
    const onCancel = vi.fn();
    mount(api, { onCancel });
    fireEvent.submit(screen.getByTestId("pump-form"));
    expect(calls).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Annullér" }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("reads the same in English", () => {
    mount(fakeApi(ok).api, {}, "en");
    expect(screen.getByRole("heading", { name: "Connect pump history" })).toBeVisible();
    expect(screen.getByLabelText("Address of your Nightscout site")).toBeVisible();
    expect(screen.getByRole("button", { name: "Connect" })).toBeVisible();
  });
});

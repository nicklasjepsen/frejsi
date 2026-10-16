import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/lib/i18n/Provider";
import { getMessages } from "@/lib/i18n/messages";
import type { AppLocale } from "@/lib/i18n/routing";

import { ConnectSourceForm } from "./ConnectSourceForm";
import { settingsApi } from "./settings-client";

const navigation = vi.hoisted(() => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  usePathname: () => "/da/settings/source",
}));

function fakeApi(answer: () => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = vi.fn((url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return Promise.resolve(answer());
  });
  return { api: settingsApi(fetchImpl as unknown as typeof fetch), calls };
}

const settings = {
  aiEnabled: false,
  name: "Almas rum",
  timezone: "Europe/Copenhagen",
  glucoseUnit: "mmol",
  targetLow: 4,
  targetHigh: 10,
  sourceType: "dexcom-share",
  sourceStatus: "connected",
  lastReadingAt: null,
};

function mount(api: ReturnType<typeof settingsApi>, locale: AppLocale = "da") {
  return render(
    <I18nProvider locale={locale} messages={getMessages(locale)}>
      <ConnectSourceForm locale={locale} spaceId="s1" sourceType="dexcom-share" api={api} />
    </I18nProvider>,
  );
}

function mountNightscout(api: ReturnType<typeof settingsApi>, locale: AppLocale = "da") {
  return render(
    <I18nProvider locale={locale} messages={getMessages(locale)}>
      <ConnectSourceForm locale={locale} spaceId="s1" sourceType="nightscout" api={api} />
    </I18nProvider>,
  );
}

// The copy under test comes from the messages, not from the sources of the Nightscout adapter.
const labels = getMessages("da").settings.connect.nightscout;

const NS_URL = "https://nightscout.example.test";

function fillNightscout() {
  fireEvent.change(screen.getByLabelText("Adresse på din Nightscout-side"), {
    target: { value: NS_URL },
  });
  fireEvent.change(screen.getByLabelText("Adgangstoken"), {
    target: { value: "example-ns-token-0123" },
  });
}

function fill() {
  fireEvent.change(screen.getByLabelText("Brugernavn"), { target: { value: "example-publisher" } });
  fireEvent.change(screen.getByLabelText("Kodeord"), { target: { value: "example-secret" } });
}

beforeEach(() => {
  navigation.push.mockClear();
  navigation.refresh.mockClear();
});
afterEach(cleanup);

describe("ConnectSourceForm ('Skift login', plan task 9)", () => {
  it("names the source by its type's message, takes username, password and server, and posts the connect body", async () => {
    const { api, calls } = fakeApi(() => Response.json(settings));
    mount(api);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Skift login");
    expect(screen.getByText("Dexcom Share")).toBeInTheDocument();
    expect(screen.getByLabelText("Kodeord")).toHaveAttribute("type", "password");
    fill();
    fireEvent.click(screen.getByRole("radio", { name: "US" }));
    fireEvent.click(screen.getByRole("button", { name: "Forbind" }));
    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(calls[0]?.url).toBe("/api/spaces/s1/source");
    expect(calls[0]?.init.method).toBe("POST");
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({
      type: "dexcom-share",
      region: "us",
      username: "example-publisher",
      password: "example-secret",
    });
  });

  it("returns to Settings when the source is connected", async () => {
    const { api } = fakeApi(() => Response.json(settings));
    mount(api);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Forbind" }));
    await waitFor(() => {
      expect(navigation.push).toHaveBeenCalledWith("/da/settings");
    });
    expect(navigation.refresh).toHaveBeenCalled();
  });

  it("shows the kind message for a refused login and for an unreachable source, and stays on the form", async () => {
    const { api } = fakeApi(() =>
      Response.json({ error: { code: "source-bad-credentials", message: "x" } }, { status: 400 }),
    );
    mount(api);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Forbind" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Brugernavn eller kodeord passer ikke. Prøv igen.",
    );
    expect(navigation.push).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Forbind" })).toBeEnabled();
    cleanup();

    const down = fakeApi(() =>
      Response.json({ error: { code: "source-unreachable", message: "x" } }, { status: 503 }),
    );
    mount(down.api);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Forbind" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Vi kunne ikke få forbindelse til kilden lige nu. Prøv igen om lidt.",
    );
  });

  it("stays on the form and says so when the login works but no readings came through for the last day", async () => {
    const { api } = fakeApi(() => Response.json({ ...settings, recentReadings: 0 }));
    mount(api);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Forbind" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Login er gemt og virker, men der kom ingen målinger for det sidste døgn.",
    );
    expect(screen.getByRole("status")).toHaveTextContent("ikke en følger-konto");
    expect(navigation.push).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
    // The owner can try another login, or go on with this one.
    expect(screen.getByRole("button", { name: "Forbind" })).toBeEnabled();
    expect(screen.getByLabelText("Kodeord")).toHaveValue("");
    expect(screen.getByRole("link", { name: "Til indstillinger" })).toHaveAttribute(
      "href",
      "/da/settings",
    );
  });

  it("goes on to Settings when readings came through, and when the count is unknown", async () => {
    const some = fakeApi(() => Response.json({ ...settings, recentReadings: 12 }));
    mount(some.api);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Forbind" }));
    await waitFor(() => {
      expect(navigation.push).toHaveBeenCalledWith("/da/settings");
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("does not post without a username and a password", () => {
    const { api, calls } = fakeApi(() => Response.json(settings));
    mount(api);
    fireEvent.click(screen.getByRole("button", { name: "Forbind" }));
    expect(calls).toEqual([]);
  });

  it("keeps the password out of the URL and out of any attribute; it travels in the body only", async () => {
    const { api, calls } = fakeApi(() => Response.json(settings));
    const { container } = mount(api);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Forbind" }));
    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(calls[0]?.url).not.toContain("example-secret");
    expect(container.innerHTML).not.toContain("example-secret");
    expect(screen.getByRole("link", { name: "Annullér" })).toHaveAttribute(
      "href",
      "/da/settings/source",
    );
  });

  it("speaks English for an English user", () => {
    const { api } = fakeApi(() => Response.json(settings));
    mount(api, "en");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Change login");
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect" })).toBeInTheDocument();
  });
});

describe("ConnectSourceForm · Nightscout (undrawn, design gap)", () => {
  it("asks for the address, a token or API secret and the secret, and posts the union body", async () => {
    const { api, calls } = fakeApi(() => Response.json({ ...settings, sourceType: "nightscout" }));
    mountNightscout(api);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Forbind Nightscout");
    expect(screen.queryByLabelText("Brugernavn")).toBeNull();
    fillNightscout();
    fireEvent.click(screen.getByRole("button", { name: "Forbind" }));
    await waitFor(() => {
      expect(navigation.push).toHaveBeenCalledWith("/da/settings");
    });
    expect(calls[0]?.url).toBe("/api/spaces/s1/source");
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({
      type: "nightscout",
      url: NS_URL,
      token: "example-ns-token-0123",
    });
    expect(navigation.refresh).toHaveBeenCalled();
  });

  it("posts an apiSecret when the segmented control says the second option", async () => {
    const { api, calls } = fakeApi(() => Response.json(settings));
    mountNightscout(api);
    fireEvent.click(screen.getByRole("radio", { name: labels.apiSecret }));
    fireEvent.change(screen.getByLabelText("Adresse på din Nightscout-side"), {
      target: { value: NS_URL },
    });
    fireEvent.change(screen.getByLabelText(labels.apiSecret, { selector: "input" }), {
      target: { value: "example-second-kind-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Forbind" }));
    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({
      type: "nightscout",
      url: NS_URL,
      apiSecret: "example-second-kind-1",
    });
  });

  it("shows source-bad-credentials as the Nightscout hint under the field, and unreachable as the usual message", async () => {
    const refused = fakeApi(() =>
      Response.json({ error: { code: "source-bad-credentials", message: "x" } }, { status: 400 }),
    );
    mountNightscout(refused.api);
    fillNightscout();
    fireEvent.click(screen.getByRole("button", { name: "Forbind" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(labels.badCredentials);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    cleanup();

    const down = fakeApi(() =>
      Response.json({ error: { code: "source-unreachable", message: "x" } }, { status: 503 }),
    );
    mountNightscout(down.api);
    fillNightscout();
    fireEvent.click(screen.getByRole("button", { name: "Forbind" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Vi kunne ikke få forbindelse til kilden lige nu. Prøv igen om lidt.",
    );
  });

  it("says so in Nightscout's words when the address works but no readings came through", async () => {
    const { api } = fakeApi(() =>
      Response.json({ ...settings, sourceType: "nightscout", recentReadings: 0 }),
    );
    mountNightscout(api);
    fillNightscout();
    fireEvent.click(screen.getByRole("button", { name: "Forbind" }));
    expect(await screen.findByRole("status")).toHaveTextContent(labels.noRecentReadings);
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it("shows the address message for source-url-invalid", async () => {
    const bad = fakeApi(() =>
      Response.json({ error: { code: "source-url-invalid", message: "x" } }, { status: 400 }),
    );
    mountNightscout(bad.api);
    fillNightscout();
    fireEvent.click(screen.getByRole("button", { name: "Forbind" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Adressen skal begynde med https://",
    );
  });

  it("does not post without an address and a secret", () => {
    const { api, calls } = fakeApi(() => Response.json(settings));
    mountNightscout(api);
    fireEvent.click(screen.getByRole("button", { name: "Forbind" }));
    expect(calls).toEqual([]);
  });
});

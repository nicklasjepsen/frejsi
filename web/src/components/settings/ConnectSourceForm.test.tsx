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
    fireEvent.click(screen.getByRole("radio", { name: "USA" }));
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
    expect(screen.getByRole("link", { name: "Annullér" })).toHaveAttribute("href", "/da/settings");
  });

  it("speaks English for an English user", () => {
    const { api } = fakeApi(() => Response.json(settings));
    mount(api, "en");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Change login");
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect" })).toBeInTheDocument();
  });
});

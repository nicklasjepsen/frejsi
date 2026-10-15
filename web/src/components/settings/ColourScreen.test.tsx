import "@testing-library/jest-dom/vitest";

import { readFileSync } from "node:fs";
import path from "node:path";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/lib/i18n/Provider";
import { getMessages } from "@/lib/i18n/messages";
import type { AppLocale } from "@/lib/i18n/routing";

import { ColourScreen } from "./ColourScreen";
import type { SourceView } from "./contracts";
import type { SettingsData, SettingsPerson } from "./load-settings";
import { settingsApi } from "./settings-client";

const navigation = vi.hoisted(() => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  usePathname: () => "/da/settings/colour",
}));

const owner: SettingsPerson = {
  userId: "u-owner",
  name: "Jonas",
  role: "owner",
  locale: "da",
  simpleMode: false,
  accent: "olive",
};
const child: SettingsPerson = {
  userId: "u-child",
  name: "Alma",
  role: "carer",
  locale: "da",
  simpleMode: true,
  accent: "plum",
};
const viewer: SettingsPerson = {
  userId: "u-viewer",
  name: "Laerke",
  role: "viewer",
  locale: "da",
  simpleMode: false,
  accent: "sea",
};

const source: SourceView = {
  type: "dexcom-share",
  region: "eu",
  status: "connected",
  lastReadingAt: "2026-10-15T13:13:00.000Z",
  since: null,
};
const data: SettingsData = {
  spaceId: "s1",
  spaceName: "Almas rum",
  subjectName: "Alma",
  timezone: "Europe/Copenhagen",
  role: "owner",
  space: {
    name: "Almas rum",
    timezone: "Europe/Copenhagen",
    glucoseUnit: "mmol",
    targetLow: 4,
    targetHigh: 10,
    sourceType: "dexcom-share",
    sourceStatus: "connected",
    lastReadingAt: "2026-10-15T13:13:00.000Z",
  },
  source,
  me: owner,
  people: [owner, child, viewer],
};

function fakeApi() {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetchImpl = vi.fn((url: string, init: RequestInit = {}) => {
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    calls.push({ url, body });
    return Promise.resolve(Response.json({ locale: "da", simpleMode: false, accent: "olive", ...body }));
  });
  return { api: settingsApi(fetchImpl as unknown as typeof fetch), calls };
}

function mount(props: SettingsData, locale: AppLocale = "da", api = fakeApi().api) {
  return render(
    <I18nProvider locale={locale} messages={getMessages(locale)} timeZone="Europe/Copenhagen">
      <ColourScreen locale={locale} data={props} api={api} />
    </I18nProvider>,
  );
}

beforeEach(() => {
  navigation.refresh.mockClear();
});
afterEach(cleanup);

describe("ColourScreen (Farve-Indstilling)", () => {
  it("offers the five colours by their Danish names, the two explanatory lines, and a way back to Settings", () => {
    mount(data);
    const swatches = screen.getByRole("radiogroup", { name: "Farver" });
    expect(within(swatches).getAllByRole("radio").map((r) => r.textContent)).toEqual([
      "Oliven",
      "Blomme",
      "Hav",
      "Skov",
      "Granat",
    ]);
    expect(
      screen.getByText(
        "Hver person vælger sin egen farve. Den ændrer kun udseendet – aldrig hvad et tal betyder.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/Måltider er altid teglrøde, og tallet er altid sort/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Tilbage" })).toHaveAttribute("href", "/da/settings");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Farve");
  });

  it("starts on oneself; the preview card carries the chosen accent and the person's name", () => {
    mount(data);
    const preview = screen.getByTestId("colour-preview");
    expect(preview).toHaveAttribute("data-accent", "olive");
    expect(preview).toHaveTextContent("Sådan ser det ud for Jonas");
    expect(within(preview).getByRole("button", { name: "Jeg spiser nu" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Vælg farven Oliven til Jonas" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("lets an owner pick for another member: the chip switches the preview, the swatch PATCHes the owner route", async () => {
    const { api, calls } = fakeApi();
    mount(data, "da", api);
    fireEvent.click(screen.getByRole("radio", { name: "Alma" }));
    const preview = screen.getByTestId("colour-preview");
    expect(preview).toHaveAttribute("data-accent", "plum");
    expect(preview).toHaveTextContent("Sådan ser det ud for Alma");
    expect(screen.getByText("Måltider er altid teglrøde, og tallet er altid sort – uanset farve. Alma kan også selv skifte under Mere.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Vælg farven Skov til Alma" }));
    await waitFor(() => {
      expect(preview).toHaveAttribute("data-accent", "forest");
    });
    expect(calls).toEqual([
      { url: "/api/spaces/s1/settings/members/u-child", body: { accent: "forest" } },
    ]);
    expect(navigation.refresh).toHaveBeenCalled();
  });

  it("sends one's own colour to /users/me", async () => {
    const { api, calls } = fakeApi();
    mount(data, "da", api);
    fireEvent.click(screen.getByRole("radio", { name: "Vælg farven Granat til Jonas" }));
    await waitFor(() => {
      expect(calls).toEqual([{ url: "/api/users/me", body: { accent: "garnet" } }]);
    });
    expect(screen.getByTestId("colour-preview")).toHaveAttribute("data-accent", "garnet");
  });

  it("gives a non-owner only themselves: no person chips", () => {
    mount({ ...data, role: "carer", me: child, people: [child] });
    expect(screen.queryByRole("radiogroup", { name: "Hvem" })).toBeNull();
    expect(screen.getByTestId("colour-preview")).toHaveAttribute("data-accent", "plum");
    expect(screen.getByText("Måltider er altid teglrøde, og tallet er altid sort – uanset farve.")).toBeInTheDocument();
  });

  it("shows owners and carers the source status in the preview and never a number without its time", () => {
    mount(data);
    expect(screen.getByTestId("preview-reading")).toHaveTextContent("forbundet");
    expect(screen.getByTestId("colour-preview").textContent).not.toMatch(/\d,\d/);
    cleanup();
    mount({ ...data, source: { ...source, status: "not-configured" } });
    expect(screen.getByTestId("preview-reading")).toHaveTextContent("Ingen målinger endnu");
  });

  it("never mounts the reading for a viewer: the band and the button only", () => {
    mount({ ...data, role: "viewer", space: null, source: null, me: viewer, people: [viewer] });
    expect(screen.queryByTestId("preview-reading")).toBeNull();
    const preview = screen.getByTestId("colour-preview");
    expect(within(preview).getByRole("button", { name: "Jeg spiser nu" })).toBeInTheDocument();
    expect(preview.textContent).not.toMatch(/\d/);
    expect(preview.textContent).not.toMatch(/forbundet|måling/);
  });

  it("shows the API's message by code when the write is refused and keeps the old colour", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(Response.json({ error: { code: "forbidden", message: "x" } }, { status: 403 })),
    );
    mount(data, "da", settingsApi(fetchImpl));
    fireEvent.click(screen.getByRole("radio", { name: "Vælg farven Hav til Jonas" }));
    await screen.findByRole("alert");
    expect(screen.getByTestId("colour-preview")).toHaveAttribute("data-accent", "olive");
    expect(navigation.refresh).not.toHaveBeenCalled();
  });

  it("takes refreshed server data over its own earlier state", async () => {
    const { api } = fakeApi();
    const view = render(
      <I18nProvider locale="da" messages={getMessages("da")} timeZone="Europe/Copenhagen">
        <ColourScreen locale="da" data={data} api={api} />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Vælg farven Granat til Jonas" }));
    await waitFor(() => {
      expect(screen.getByTestId("colour-preview")).toHaveAttribute("data-accent", "garnet");
    });
    const refreshed: SettingsData = {
      ...data,
      people: data.people.map((p) => (p.userId === owner.userId ? { ...p, accent: "sea" } : p)),
    };
    view.rerender(
      <I18nProvider locale="da" messages={getMessages("da")} timeZone="Europe/Copenhagen">
        <ColourScreen locale="da" data={refreshed} api={api} />
      </I18nProvider>,
    );
    expect(screen.getByTestId("colour-preview")).toHaveAttribute("data-accent", "sea");
  });

  it("speaks English for an English user", () => {
    mount({ ...data, me: { ...owner, locale: "en" } }, "en");
    expect(screen.getByRole("radio", { name: "Pick the colour Plum for Jonas" })).toBeInTheDocument();
    expect(screen.getByText("How it looks for Jonas")).toBeInTheDocument();
  });

  it("does not know Dexcom", () => {
    const source = readFileSync(path.join(import.meta.dirname, "ColourScreen.tsx"), "utf8");
    expect(source).not.toMatch(/dexcom/i);
  });
});

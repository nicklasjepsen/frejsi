import "@testing-library/jest-dom/vitest";

import { readFileSync } from "node:fs";
import path from "node:path";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/lib/i18n/Provider";
import { getMessages } from "@/lib/i18n/messages";
import type { AppLocale } from "@/lib/i18n/routing";

import type { SpaceSettings } from "@frejsi/shared";
import { GlucoseSourceType } from "@frejsi/shared/schemas/glucose";

import type { SourceView } from "./contracts";
import type { SettingsData, SettingsPerson } from "./load-settings";
import { SettingsScreen } from "./SettingsScreen";
import { settingsApi } from "./settings-client";

const navigation = vi.hoisted(() => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  usePathname: () => "/da/settings",
}));

const NOW = "2026-10-15T14:00:00.000Z";

const owner: SettingsPerson = {
  userId: "u-owner",
  name: "Jonas",
  role: "owner",
  locale: "da",
  simpleMode: false,
  accent: "olive",
  theme: "system",
};
const child: SettingsPerson = {
  userId: "u-child",
  name: "Alma",
  role: "carer",
  locale: "da",
  simpleMode: true,
  accent: "plum",
  theme: "system",
};
const grandma: SettingsPerson = {
  userId: "u-grandma",
  name: "Farmor Birthe",
  role: "carer",
  locale: "da",
  simpleMode: false,
  accent: "olive",
  theme: "system",
};
const viewer: SettingsPerson = {
  userId: "u-viewer",
  name: "Laerke",
  role: "viewer",
  locale: "da",
  simpleMode: false,
  accent: "sea",
  theme: "system",
};

const space: SpaceSettings = {
  aiEnabled: false,
  name: "Almas rum",
  timezone: "Europe/Copenhagen",
  glucoseUnit: "mmol",
  targetLow: 4,
  targetHigh: 10,
  sourceType: "dexcom-share",
  sourceStatus: "connected",
  lastReadingAt: "2026-10-15T13:13:00.000Z",
};
const source: SourceView = {
  type: "dexcom-share",
  region: "eu",
  status: "connected",
  lastReadingAt: "2026-10-15T13:13:00.000Z",
  since: "2026-10-15T06:00:00.000Z",
};
const connected: SettingsData = {
  spaceId: "s1",
  spaceName: "Almas rum",
  subjectName: "Alma",
  timezone: "Europe/Copenhagen",
  role: "owner",
  space,
  source,
  me: owner,
  people: [owner, child, grandma, viewer],
};

/** The nth element, or a failing test instead of an undefined receiver. */
function nth<T>(items: T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`no item at ${index}`);
  return item;
}

/** A fetch that answers every PATCH with the patch merged into a sensible body. */
function fakeApi() {
  const calls: { url: string; method: string; body: Record<string, unknown> }[] = [];
  const fetchImpl = vi.fn((url: string, init: RequestInit = {}) => {
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    calls.push({ url, method: init.method ?? "GET", body });
    if (url.endsWith("/settings")) {
      return Promise.resolve(Response.json({ ...connected.space, ...body }));
    }
    return Promise.resolve(
      Response.json({ locale: "da", simpleMode: false, accent: "olive", theme: "system", ...body }),
    );
  });
  return { api: settingsApi(fetchImpl as unknown as typeof fetch), calls };
}

function mount(data: SettingsData, locale: AppLocale = "da", api = fakeApi().api) {
  return render(
    <I18nProvider locale={locale} messages={getMessages(locale)} timeZone="Europe/Copenhagen">
      <SettingsScreen locale={locale} data={data} now={NOW} api={api} />
    </I18nProvider>,
  );
}

beforeEach(() => {
  navigation.refresh.mockClear();
  navigation.replace.mockClear();
});
afterEach(cleanup);

describe("SettingsScreen · the source (Indstillinger-Telefon, Indstillinger-Desktop)", () => {
  it("writes the phone row and the desktop card as drawn, with the source named by its type's message", () => {
    mount(connected);
    expect(screen.getByTestId("source-row")).toHaveTextContent(
      "Dexcom Share · forbundet · sidste måling 15:13",
    );
    expect(screen.getByTestId("source-card")).toHaveTextContent(
      "Forbundet · sidste måling i dag 15:13 · EU-server · henter hvert 5. minut",
    );
    expect(
      screen.getByText("Hvor Frejsi henter Almas målinger fra. Én kilde ad gangen."),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Skift login" })[0]).toHaveAttribute(
      "href",
      "/da/settings/source/connect?type=dexcom-share",
    );
  });

  it("says the day when the last reading is not from today", () => {
    mount({
      ...connected,
      source: { ...source, lastReadingAt: "2026-10-14T13:13:00.000Z" },
    });
    expect(screen.getByTestId("source-card")).toHaveTextContent(/sidste måling 14\.? okt\.? 15:13/);
  });

  it("has no 'coming later' rows in the source section and keeps the AI row and the phone footer", () => {
    mount(connected);
    const section = screen.getByTestId("source-section");
    expect(within(section).queryByText("Kommer i en senere version")).toBeNull();
    expect(screen.getByRole("heading", { name: "AI-hjælp" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "AI-hjælp" })).toBeDisabled();
    expect(screen.getByText("Frejsi · åben kildekode · regner aldrig insulin")).toBeInTheDocument();
  });

  it("draws one card per source type, from the enum, with the drawn descriptions and buttons", () => {
    mount(connected);
    const cards = within(screen.getByTestId("source-section"));
    expect(GlucoseSourceType.options).toHaveLength(3);
    expect(cards.getByTestId("source-card")).toHaveTextContent("Dexcom Share");
    const nightscout = within(cards.getByTestId("source-card-nightscout"));
    expect(nightscout.getByText("Din egen Nightscout-side som kilde")).toBeInTheDocument();
    expect(nightscout.getByRole("link", { name: "Forbind" })).toHaveAttribute(
      "href",
      "/da/settings/source/connect?type=nightscout",
    );
    const manual = within(cards.getByTestId("source-card-manual"));
    expect(manual.getByText("Fingerprik-målinger tastes ind. Uden sensor.")).toBeInTheDocument();
    expect(manual.getByRole("button", { name: "Vælg" })).toBeInTheDocument();
    expect(cards.getAllByTestId("source-card")).toHaveLength(1);
    expect(
      cards.getByText(/Login til Dexcom Share gemmes i et låst hvælv, aldrig i databasen/),
    ).toBeInTheDocument();
  });

  it("writes the Nightscout card and row without a region", () => {
    mount({
      ...connected,
      space: { ...space, sourceType: "nightscout" },
      source: { ...source, type: "nightscout", region: null },
    });
    expect(screen.getByTestId("source-card")).toHaveTextContent(
      "Forbundet · sidste måling i dag 15:13 · henter hvert 5. minut",
    );
    expect(screen.getByTestId("source-card")).toHaveTextContent("Skift login");
    expect(screen.getByTestId("source-row")).toHaveTextContent(
      "Nightscout · forbundet · sidste måling 15:13",
    );
  });

  it("writes the Manuelt card, row and notice", () => {
    mount({
      ...connected,
      space: { ...space, sourceType: "manual" },
      source: { ...source, type: "manual", region: null },
    });
    expect(screen.getByTestId("source-card")).toHaveTextContent(
      "Fingerprik-målinger · sidste måling i dag 15:13",
    );
    expect(screen.getByTestId("source-row")).toHaveTextContent("Manuelt · sidste måling 15:13");
    expect(screen.getByText("Målinger tastes ind på Nu-skærmen.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Vælg" })).toBeNull();
  });

  it("shows a carer the cards read-only: no buttons, no link on the row", () => {
    mount({ ...connected, role: "carer", me: grandma, people: [grandma] });
    const section = within(screen.getByTestId("source-section"));
    expect(section.queryByRole("link")).toBeNull();
    expect(section.queryByRole("button")).toBeNull();
    expect(screen.getByTestId("source-row")).not.toHaveAttribute("href");
  });

  it("asks before leaving a fetching source for Manuelt, writes only after the answer, and re-renders from the response", async () => {
    const calls: { url: string; body: unknown }[] = [];
    const fetchImpl = vi.fn((url: string, init: RequestInit = {}) => {
      calls.push({ url, body: JSON.parse(init.body as string) });
      return Promise.resolve(
        Response.json({ ...space, sourceType: "manual", lastReadingAt: null }),
      );
    });
    mount(connected, "da", settingsApi(fetchImpl as unknown as typeof fetch));
    fireEvent.click(screen.getByRole("button", { name: "Vælg" }));
    expect(screen.getByTestId("manual-confirm")).toHaveTextContent(
      "Skift til manuelle målinger? Frejsi henter så ikke længere fra Dexcom Share.",
    );
    expect(calls).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Annullér" }));
    expect(screen.queryByTestId("manual-confirm")).toBeNull();
    expect(calls).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Vælg" }));
    fireEvent.click(screen.getByRole("button", { name: "Skift til manuelt" }));
    await waitFor(() => {
      expect(screen.getByTestId("source-card")).toHaveTextContent("Fingerprik-målinger");
    });
    expect(calls).toEqual([{ url: "/api/spaces/s1/source", body: { type: "manual" } }]);
    expect(screen.getByTestId("source-row")).toHaveTextContent("Manuelt · ingen målinger endnu");
    expect(navigation.refresh).toHaveBeenCalled();
  });

  it("chooses Manuelt at once when no source is configured, and shows a refusal", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        Response.json({ error: { code: "forbidden", message: "x" } }, { status: 403 }),
      ),
    );
    mount(
      {
        ...connected,
        space: { ...space, sourceType: null, sourceStatus: "not-configured" },
        source: {
          type: null,
          region: null,
          status: "not-configured",
          lastReadingAt: null,
          since: null,
        },
      },
      "da",
      settingsApi(fetchImpl),
    );
    fireEvent.click(screen.getByRole("button", { name: "Vælg" }));
    expect(screen.queryByTestId("manual-confirm")).toBeNull();
    expect(await screen.findAllByRole("alert")).not.toHaveLength(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("shows the SourceStatusBanner while disconnected, with the time it went down", () => {
    mount({
      ...connected,
      space: { ...space, sourceStatus: "disconnected" },
      source: { ...source, status: "disconnected", since: "2026-10-15T12:05:00.000Z" },
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Ingen forbindelse til Dexcom Share siden 14:05",
    );
    expect(screen.getByTestId("source-row")).toHaveTextContent("Dexcom Share · ingen forbindelse");
  });

  it("does not know Dexcom: the only source-specific text comes from the message for the type", () => {
    const source = readFileSync(path.join(import.meta.dirname, "SettingsScreen.tsx"), "utf8");
    expect(source).not.toMatch(/dexcom/i);
  });
});

describe("SettingsScreen · unit and target range (per space, owners only)", () => {
  it("lets an owner switch to mg/dL, PATCHes the space and re-renders with the new values", async () => {
    const { api, calls } = fakeApi();
    mount(connected, "da", api);
    fireEvent.click(screen.getByRole("radio", { name: "mg/dL" }));
    await waitFor(() => {
      expect(screen.getByRole("radio", { name: "mg/dL" })).toHaveAttribute("aria-checked", "true");
    });
    expect(calls).toEqual([
      { url: "/api/spaces/s1/settings", method: "PATCH", body: { glucoseUnit: "mgdl" } },
    ]);
    expect(navigation.refresh).toHaveBeenCalled();
    // The target range now shows in mg/dL: 4 → 72, 10 → 180.
    expect(screen.getByLabelText("Nedre grænse")).toHaveValue(72);
    expect(screen.getByLabelText("Øvre grænse")).toHaveValue(180);
  });

  it("saves the target range in mmol with one decimal and emits nothing itself", async () => {
    const { api, calls } = fakeApi();
    mount(connected, "da", api);
    fireEvent.change(screen.getByLabelText("Nedre grænse"), { target: { value: "3.9" } });
    fireEvent.change(screen.getByLabelText("Øvre grænse"), { target: { value: "9.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Gem" }));
    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(calls[0]).toEqual({
      url: "/api/spaces/s1/settings",
      method: "PATCH",
      body: { targetLow: 3.9, targetHigh: 9.5 },
    });
    expect(screen.getByText("mmol/L · som aftalt med klinikken")).toBeInTheDocument();
  });

  it("converts an mg/dL range back to mmol before saving", async () => {
    const { api, calls } = fakeApi();
    mount({ ...connected, space: { ...space, glucoseUnit: "mgdl" } }, "da", api);
    fireEvent.change(screen.getByLabelText("Nedre grænse"), { target: { value: "70" } });
    fireEvent.change(screen.getByLabelText("Øvre grænse"), { target: { value: "180" } });
    fireEvent.click(screen.getByRole("button", { name: "Gem" }));
    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(nth(calls, 0).body).toEqual({ targetLow: 3.9, targetHigh: 10 });
  });

  it("shows the mmol an mg/dL range will be stored as, so rounding is visible", () => {
    mount({ ...connected, space: { ...space, glucoseUnit: "mgdl" } }, "da", fakeApi().api);
    fireEvent.change(screen.getByLabelText("Nedre grænse"), { target: { value: "70" } });
    fireEvent.change(screen.getByLabelText("Øvre grænse"), { target: { value: "179" } });
    expect(screen.getByTestId("target-range-stored")).toHaveTextContent(
      "Gemmes som 3,9–9,9 mmol/L",
    );
  });

  it("refuses a range that collapses after conversion, says why, and saves nothing", () => {
    const { api, calls } = fakeApi();
    mount({ ...connected, space: { ...space, glucoseUnit: "mgdl" } }, "da", api);
    fireEvent.change(screen.getByLabelText("Nedre grænse"), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText("Øvre grænse"), { target: { value: "101" } });
    fireEvent.click(screen.getByRole("button", { name: "Gem" }));
    expect(calls).toEqual([]);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Den nedre grænse skal være lavere end den øvre.",
    );
    fireEvent.change(screen.getByLabelText("Øvre grænse"), { target: { value: "180" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not save an emptied bound as zero", () => {
    const { api, calls } = fakeApi();
    mount(connected, "da", api);
    fireEvent.change(screen.getByLabelText("Nedre grænse"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Gem" }));
    expect(calls).toEqual([]);
    expect(screen.getByLabelText("Nedre grænse")).toBeRequired();
  });

  it("takes refreshed server data over its own earlier state: another owner's change is seen, not overwritten", async () => {
    const { api } = fakeApi();
    const view = render(
      <I18nProvider locale="da" messages={getMessages("da")} timeZone="Europe/Copenhagen">
        <SettingsScreen locale="da" data={connected} now={NOW} api={api} />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole("radio", { name: "mg/dL" }));
    await waitFor(() => {
      expect(screen.getByRole("radio", { name: "mg/dL" })).toHaveAttribute("aria-checked", "true");
    });
    // router.refresh() re-renders the page with what the server has now: a new data object.
    const refreshed: SettingsData = {
      ...connected,
      space: { ...space, glucoseUnit: "mmol", targetLow: 3.5, targetHigh: 9 },
      people: connected.people.map((p) =>
        p.userId === child.userId ? { ...p, simpleMode: false } : p,
      ),
    };
    view.rerender(
      <I18nProvider locale="da" messages={getMessages("da")} timeZone="Europe/Copenhagen">
        <SettingsScreen locale="da" data={refreshed} now={NOW} api={api} />
      </I18nProvider>,
    );
    expect(screen.getByRole("radio", { name: "mmol/L" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText("Nedre grænse")).toHaveValue(3.5);
    expect(screen.getByLabelText("Øvre grænse")).toHaveValue(9);
    expect(screen.getByRole("switch", { name: "Simpel visning for Alma" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("shows a carer the unit but offers no change, and no target range", () => {
    mount({ ...connected, role: "carer", me: grandma, people: [grandma] });
    expect(screen.getByRole("radio", { name: "mmol/L" })).toBeDisabled();
    expect(screen.queryByLabelText("Nedre grænse")).toBeNull();
    expect(screen.queryByRole("link", { name: "Skift login" })).toBeNull();
    expect(
      screen.getByText("Du kan ændre dit eget sprog, din visning og din farve"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/kun ejere kan ændre her/)).toBeNull();
  });

  it("shows the owner the subtitle 'kun ejere kan ændre her'", () => {
    mount(connected);
    expect(screen.getByText("Almas rum · kun ejere kan ændre her")).toBeInTheDocument();
  });

  it("shows the API's message by code when a save is refused, and keeps the old value", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        Response.json({ error: { code: "forbidden", message: "x" } }, { status: 403 }),
      ),
    );
    mount(connected, "da", settingsApi(fetchImpl));
    fireEvent.click(screen.getByRole("radio", { name: "mg/dL" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("alert")).toHaveTextContent(/ikke adgang/);
    expect(screen.getByRole("radio", { name: "mmol/L" })).toHaveAttribute("aria-checked", "true");
    expect(navigation.refresh).not.toHaveBeenCalled();
  });
});

describe("SettingsScreen · language, simpleMode and colour (per person)", () => {
  it("lists every member for an owner: a switch for everyone but the viewer, a language control for everyone but oneself", () => {
    mount(connected);
    const rows = screen.getAllByTestId("person-row");
    expect(
      rows.map((r) => within(r).queryByRole("switch")?.getAttribute("aria-label") ?? null),
    ).toEqual([
      "Simpel visning for Jonas",
      "Simpel visning for Alma",
      "Simpel visning for Farmor Birthe",
      null,
    ]);
    expect(
      rows.map((r) => within(r).queryByRole("radiogroup")?.getAttribute("aria-label") ?? null),
    ).toEqual([null, "Sprog for Alma", "Sprog for Farmor Birthe", "Sprog for Laerke"]);
    expect(nth(rows, 0)).toHaveTextContent("Jonas (dig)");
    expect(within(nth(rows, 1)).getByRole("switch")).toHaveAttribute("aria-checked", "true");
  });

  it("lets an owner set a viewer's language, but offers no simpleMode switch for them", async () => {
    const { api, calls } = fakeApi();
    mount(connected, "da", api);
    expect(screen.queryByRole("switch", { name: "Simpel visning for Laerke" })).toBeNull();
    const group = screen.getByRole("radiogroup", { name: "Sprog for Laerke" });
    fireEvent.click(within(group).getByRole("radio", { name: "English" }));
    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(calls[0]).toEqual({
      url: "/api/spaces/s1/settings/members/u-viewer",
      method: "PATCH",
      body: { locale: "en" },
    });
  });

  it("lets an owner set a member's view through the owner route and re-renders from the response", async () => {
    const { api, calls } = fakeApi();
    mount(connected, "da", api);
    fireEvent.click(screen.getByRole("switch", { name: "Simpel visning for Farmor Birthe" }));
    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(calls[0]).toEqual({
      url: "/api/spaces/s1/settings/members/u-grandma",
      method: "PATCH",
      body: { simpleMode: true },
    });
    await waitFor(() => {
      expect(
        screen.getByRole("switch", { name: "Simpel visning for Farmor Birthe" }),
      ).toHaveAttribute("aria-checked", "true");
    });
    expect(navigation.refresh).toHaveBeenCalled();
  });

  it("lets an owner set a member's language through the owner route", async () => {
    const { api, calls } = fakeApi();
    mount(connected, "da", api);
    const group = screen.getByRole("radiogroup", { name: "Sprog for Alma" });
    fireEvent.click(within(group).getByRole("radio", { name: "English" }));
    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(calls[0]).toEqual({
      url: "/api/spaces/s1/settings/members/u-child",
      method: "PATCH",
      body: { locale: "en" },
    });
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it("sends one's own language to /users/me and moves to the same page in that language", async () => {
    const { api, calls } = fakeApi();
    mount(connected, "da", api);
    const group = screen.getByRole("radiogroup", { name: "Sprog" });
    fireEvent.click(within(group).getByRole("radio", { name: "English" }));
    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(calls[0]).toEqual({ url: "/api/users/me", method: "PATCH", body: { locale: "en" } });
    await waitFor(() => {
      expect(navigation.replace).toHaveBeenCalledWith("/en/settings");
    });
  });

  it("gives a carer only their own row and the Farve row, which shows their colour and links to the Farve screen", () => {
    mount({ ...connected, role: "carer", me: child, people: [child] });
    expect(screen.getAllByTestId("person-row")).toHaveLength(1);
    expect(screen.getByRole("switch", { name: "Simpel visning for Alma" })).toBeInTheDocument();
    const colour = screen.getByTestId("colour-row");
    expect(colour).toHaveAttribute("href", "/da/settings/colour");
    expect(colour).toHaveTextContent("Farve");
    expect(colour).toHaveTextContent("Blomme");
  });

  it("gives a viewer no space section at all and no simpleMode switch, only language and Farve", () => {
    const { container } = mount({
      ...connected,
      role: "viewer",
      space: null,
      source: null,
      me: viewer,
      people: [viewer],
    });
    expect(screen.queryByTestId("source-section")).toBeNull();
    expect(screen.queryByTestId("ai-section")).toBeNull();
    expect(screen.queryByRole("radio", { name: "mg/dL" })).toBeNull();
    expect(screen.queryByLabelText("Nedre grænse")).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("radiogroup", { name: "Sprog" })).toBeInTheDocument();
    expect(screen.getByTestId("colour-row")).toHaveTextContent("Hav");
    expect(screen.getByTestId("colour-row")).not.toHaveTextContent("Mørk");
    // No switch means no "Simpel visning" section: the Farve row stands under its own heading.
    expect(screen.queryByRole("heading", { name: "Simpel visning" })).toBeNull();
    expect(screen.queryByText(/Stor, billedbaseret/)).toBeNull();
    expect(screen.getByRole("heading", { name: "Farve" })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/mmol|mg\/dL|Dexcom|Glukosekilde/);
  });

  it("names a forced theme next to the colour on the Farve row", () => {
    mount({
      ...connected,
      role: "viewer",
      space: null,
      source: null,
      me: { ...viewer, theme: "dark" },
      people: [{ ...viewer, theme: "dark" }],
    });
    expect(screen.getByTestId("colour-row")).toHaveTextContent("Hav · Mørk");
  });

  it("speaks English for an English user", () => {
    mount({ ...connected, me: { ...owner, locale: "en" } }, "en");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Settings");
    expect(screen.getByTestId("source-row")).toHaveTextContent(
      "Dexcom Share · connected · last reading 15:13",
    );
    expect(screen.getByText("Almas rum · only owners can change things here")).toBeInTheDocument();
  });
});

describe("SettingsScreen · data (import, #154)", () => {
  it("offers an owner the import under Data, named by the format's message", () => {
    mount(connected);
    const row = screen.getByTestId("import-row");
    expect(row).toHaveTextContent("Importér fra Dexcom Clarity");
    expect(row).toHaveAttribute("href", "/da/settings/import");
    expect(screen.getAllByText("Eksport til klinikken").length).toBeGreaterThan(0);
  });

  it("shows no import to a carer", () => {
    mount({ ...connected, role: "carer", me: grandma, people: [grandma] });
    expect(screen.queryByTestId("import-row")).toBeNull();
  });
});

it("switches AI off through the API, immediately re-renders the phone suffix and preserves import", async () => {
  const { api, calls } = fakeApi();
  mount({ ...connected, space: { ...space, aiEnabled: true, aiProvider: "anthropic" } }, "da", api);
  expect(screen.getByTestId("ai-row")).toHaveTextContent("· Anthropic");
  fireEvent.click(screen.getByRole("switch", { name: "AI-hjælp" }));
  await waitFor(() => expect(screen.getByTestId("ai-row")).toHaveTextContent("· fra"));
  expect(calls).toEqual([
    { url: "/api/spaces/s1/settings", method: "PATCH", body: { aiEnabled: false } },
  ]);
  expect(screen.getByTestId("import-row")).toHaveAttribute("href", "/da/settings/import");
});

describe("SettingsScreen · Pumpehistorik (v0.7.0 plan task 3, §9 item 5)", () => {
  // 13:08 in Copenhagen; the newest record is from 11:58.
  const PUMP_NOW = "2026-10-15T11:08:00.000Z";
  const pumpConnected = {
    status: "connected" as const,
    since: "2026-10-15T06:00:00.000Z",
    lastPumpAt: "2026-10-15T09:58:00.000Z",
    configured: true,
  };
  const mountAt = (data: SettingsData) =>
    render(
      <I18nProvider locale="da" messages={getMessages("da")} timeZone="Europe/Copenhagen">
        <SettingsScreen locale="da" data={data} now={PUMP_NOW} api={fakeApi().api} />
      </I18nProvider>,
    );

  it("puts the card beside the glucose source on desktop and a row leading to settings/pump on the phone", () => {
    mountAt({ ...connected, pump: { status: "not-configured", configured: false } });
    const section = screen.getByTestId("source-section");
    const pumpCard = within(section).getByTestId("pump-card");
    expect(within(pumpCard).getByRole("heading", { name: "Pumpehistorik" })).toBeInTheDocument();
    expect(within(pumpCard).getByTestId("pump-status")).toHaveTextContent("Ikke forbundet");
    expect(within(pumpCard).getByRole("button", { name: "Forbind" })).toBeInTheDocument();
    // The card follows the glucose cards inside the same desktop column.
    const cards = within(section).getByTestId("source-card");
    expect(cards.compareDocumentPosition(pumpCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const row = within(section).getByTestId("pump-row");
    expect(row).toHaveTextContent("Pumpehistorik");
    expect(row).toHaveTextContent("Ikke forbundet");
    expect(row).toHaveAttribute("href", "/da/settings/pump");
  });

  it("writes the newest record on the card and the row when connected, and the failure when disconnected", () => {
    mountAt({ ...connected, pump: pumpConnected });
    expect(screen.getByTestId("pump-latest")).toHaveTextContent(
      "Senest fra pumpen: 11:58 · for 1 t 10 min siden",
    );
    expect(screen.getByTestId("pump-row")).toHaveTextContent("Forbundet · senest fra pumpen 11:58");
    cleanup();
    mountAt({
      ...connected,
      pump: { ...pumpConnected, status: "disconnected", since: "2026-10-15T12:05:00.000Z" },
    });
    expect(screen.getByTestId("pump-status")).toHaveTextContent("Forbindelsen svigter siden 14:05");
    expect(screen.getByTestId("pump-row")).toHaveTextContent("Forbindelsen svigter siden 14:05");
  });

  it("shows a carer the status without the form: no button on the card, the row still opens the page", () => {
    mountAt({ ...connected, role: "carer", me: grandma, people: [grandma], pump: pumpConnected });
    const pumpCard = screen.getByTestId("pump-card");
    expect(within(pumpCard).getByTestId("pump-status")).toHaveTextContent("Forbundet");
    expect(within(pumpCard).queryAllByRole("button")).toEqual([]);
    expect(screen.queryByTestId("pump-form")).toBeNull();
    expect(screen.getByTestId("pump-row")).toHaveAttribute("href", "/da/settings/pump");
  });

  it("shows nothing of the pump to a viewer, nor when the loader gave no pump (simpleMode)", () => {
    const { container } = mountAt({
      ...connected,
      role: "viewer",
      space: null,
      source: null,
      pump: null,
      me: viewer,
      people: [viewer],
    });
    expect(screen.queryByTestId("pump-card")).toBeNull();
    expect(screen.queryByTestId("pump-row")).toBeNull();
    expect(container.textContent).not.toMatch(/Pumpehistorik|pumpen/);
    cleanup();
    mountAt({ ...connected, pump: null });
    expect(screen.queryByTestId("pump-card")).toBeNull();
    expect(screen.queryByTestId("pump-row")).toBeNull();
    cleanup();
    const { pump: _none, ...withoutPump } = { ...connected, pump: null };
    mountAt(withoutPump);
    expect(screen.queryByTestId("pump-card")).toBeNull();
  });
});

import "@testing-library/jest-dom/vitest";

import { readFileSync } from "node:fs";
import path from "node:path";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/lib/i18n/Provider";
import { getMessages } from "@/lib/i18n/messages";
import type { AppLocale } from "@/lib/i18n/routing";
import type { LiveState } from "@/lib/live/live-feed";
import { applyTheme } from "@/lib/theme/theme";

const live = vi.hoisted(() => ({
  state: null as LiveState | null,
  calls: [] as unknown[],
}));
vi.mock("@/lib/live/useLiveFeed", () => ({
  useLiveFeed: (...args: unknown[]) => {
    live.calls.push(args);
    return live.state;
  },
}));

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
const viewer: SettingsPerson = {
  userId: "u-viewer",
  name: "Laerke",
  role: "viewer",
  locale: "da",
  simpleMode: false,
  accent: "sea",
  theme: "system",
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
    aiEnabled: false,
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

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
function liveState(over: Partial<LiveState> = {}): LiveState {
  const latest = { ts: minutesAgo(3), mmol: 6.2, trend: "forty-five-up" as const };
  return {
    loaded: true,
    connection: "live",
    lastSeq: 40,
    readings: [latest],
    latest,
    sourceStatus: "connected",
    sourceSince: null,
    space: {
      glucoseUnit: "mmol",
      targetLow: 4,
      targetHigh: 10,
      timezone: "Europe/Copenhagen",
      sourceType: "dexcom-share",
    },
    error: null,
    ...over,
  };
}

function fakeApi() {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetchImpl = vi.fn((url: string, init: RequestInit = {}) => {
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    calls.push({ url, body });
    return Promise.resolve(
      Response.json({ locale: "da", simpleMode: false, accent: "olive", theme: "system", ...body }),
    );
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
  live.state = liveState();
  live.calls.length = 0;
});
afterEach(() => {
  cleanup();
  applyTheme("system");
});

describe("ColourScreen (Farve-Indstilling)", () => {
  it("offers the five colours by their Danish names, the two explanatory lines, and a way back to Settings", () => {
    mount(data);
    const swatches = screen.getByRole("radiogroup", { name: "Farver" });
    expect(
      within(swatches)
        .getAllByRole("radio")
        .map((r) => r.textContent),
    ).toEqual(["Oliven", "Blomme", "Hav", "Skov", "Granat"]);
    expect(
      screen.getByText(
        "Hver person vælger sin egen farve. Den ændrer kun udseendet – aldrig hvad et tal betyder.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Måltider er altid teglrøde, og tallet er altid sort/),
    ).toBeInTheDocument();
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
    expect(
      screen.getByText(
        "Måltider er altid teglrøde, og tallet er altid sort – uanset farve. Alma kan også selv skifte under Mere.",
      ),
    ).toBeInTheDocument();

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
    expect(
      screen.getByText("Måltider er altid teglrøde, og tallet er altid sort – uanset farve."),
    ).toBeInTheDocument();
  });

  it("shows owners and carers the latest live reading with its age in the preview", () => {
    mount(data);
    expect(live.calls).toEqual([["s1", { hours: 1 }]]);
    const preview = within(screen.getByTestId("colour-preview"));
    expect(preview.getByTestId("glucose-number")).toHaveTextContent("6,2");
    expect(preview.getByTestId("glucose-age")).toHaveTextContent(
      "mmol/L · for 3 min. siden · stiger langsomt",
    );
  });

  it("says 'Ingen målinger endnu' in the preview when there is no reading yet", () => {
    live.state = liveState({ readings: [], latest: null, sourceStatus: "not-configured" });
    mount(data);
    const preview = within(screen.getByTestId("colour-preview"));
    expect(preview.getByText("Ingen målinger endnu")).toBeInTheDocument();
    expect(preview.queryByTestId("glucose-number")).toBeNull();
  });

  it("shows no number and no empty text before the feed has loaded or when it is refused", () => {
    live.state = liveState({ loaded: false, latest: null, readings: [] });
    mount(data);
    let preview = screen.getByTestId("colour-preview");
    expect(within(preview).queryByTestId("glucose-number")).toBeNull();
    expect(preview.textContent).not.toMatch(/Ingen målinger/);
    cleanup();
    live.state = liveState({ error: "forbidden", latest: null, readings: [] });
    mount(data);
    preview = screen.getByTestId("colour-preview");
    expect(within(preview).queryByTestId("glucose-number")).toBeNull();
  });

  it("speaks English in the empty preview", () => {
    live.state = liveState({ readings: [], latest: null });
    mount({ ...data, me: { ...owner, locale: "en" } }, "en");
    expect(
      within(screen.getByTestId("colour-preview")).getByText("No readings yet"),
    ).toBeInTheDocument();
  });

  it("never mounts the reading for a viewer: their own tab bar in the band, no logging button", () => {
    mount({ ...data, role: "viewer", space: null, source: null, me: viewer, people: [viewer] });
    expect(live.calls).toEqual([]);
    expect(screen.queryByTestId("glucose-number")).toBeNull();
    expect(screen.queryByTestId("glucose-age")).toBeNull();
    const preview = screen.getByTestId("colour-preview");
    expect(within(preview).queryByRole("button", { name: "Jeg spiser nu" })).toBeNull();
    const tabs = within(preview).getByTestId("preview-tabs");
    expect(tabs).toHaveTextContent("I dag");
    expect(tabs).toHaveTextContent("Tidligere dage");
    expect(tabs).toHaveTextContent("Mere");
    expect(preview.textContent).not.toMatch(/\d/);
    expect(preview.textContent).not.toMatch(/forbundet|måling|Nu|Måltid/);
  });

  it("shows the API's message by code when the write is refused and keeps the old colour", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        Response.json({ error: { code: "forbidden", message: "x" } }, { status: 403 }),
      ),
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
    expect(
      screen.getByRole("radio", { name: "Pick the colour Plum for Jonas" }),
    ).toBeInTheDocument();
    expect(screen.getByText("How it looks for Jonas")).toBeInTheDocument();
  });

  describe("light or dark", () => {
    it("offers the device, light and dark for the chosen person, in Danish and English", () => {
      mount(data);
      const control = screen.getByRole("radiogroup", { name: "Lys eller mørk for Jonas" });
      expect(
        within(control)
          .getAllByRole("radio")
          .map((r) => r.textContent),
      ).toEqual(["Som enheden", "Lys", "Mørk"]);
      expect(within(control).getByRole("radio", { name: "Som enheden" })).toHaveAttribute(
        "aria-checked",
        "true",
      );
      expect(screen.getByText("Følg enheden, eller vælg lys eller mørk.")).toBeInTheDocument();
      cleanup();
      mount({ ...data, me: { ...owner, locale: "en" } }, "en");
      const english = screen.getByRole("radiogroup", { name: "Light or dark for Jonas" });
      expect(
        within(english)
          .getAllByRole("radio")
          .map((r) => r.textContent),
      ).toEqual(["Like the device", "Light", "Dark"]);
      expect(screen.getByText("Follow the device, or choose light or dark.")).toBeInTheDocument();
    });

    it("one's own choice switches the document at once, writes the cookie and saves to /users/me", async () => {
      const { api, calls } = fakeApi();
      mount(data, "da", api);
      fireEvent.click(screen.getByRole("radio", { name: "Mørk" }));
      // Seen before the save answers.
      expect(document.documentElement.dataset.theme).toBe("dark");
      expect(document.cookie).toContain("frejsi_theme=dark");
      await waitFor(() => {
        expect(calls).toEqual([{ url: "/api/users/me", body: { theme: "dark" } }]);
      });
      await waitFor(() => {
        expect(screen.getByRole("radio", { name: "Mørk" })).toHaveAttribute("aria-checked", "true");
      });
      expect(navigation.refresh).toHaveBeenCalled();

      fireEvent.click(screen.getByRole("radio", { name: "Som enheden" }));
      expect(document.documentElement.dataset.theme).toBeUndefined();
      expect(document.cookie).not.toContain("frejsi_theme");
      await waitFor(() => {
        expect(calls).toHaveLength(2);
      });
      expect(calls[1]).toEqual({ url: "/api/users/me", body: { theme: "system" } });
    });

    it("puts the document back and shows the message when the save is refused", async () => {
      const fetchImpl = vi.fn(() =>
        Promise.resolve(
          Response.json({ error: { code: "forbidden", message: "x" } }, { status: 403 }),
        ),
      );
      mount(data, "da", settingsApi(fetchImpl));
      fireEvent.click(screen.getByRole("radio", { name: "Lys" }));
      expect(document.documentElement.dataset.theme).toBe("light");
      await screen.findByRole("alert");
      expect(document.documentElement.dataset.theme).toBeUndefined();
      expect(document.cookie).not.toContain("frejsi_theme");
      expect(screen.getByRole("radio", { name: "Som enheden" })).toHaveAttribute(
        "aria-checked",
        "true",
      );
    });

    it("an owner's choice for another member is stored through the owner route and leaves this device alone", async () => {
      const { api, calls } = fakeApi();
      mount(data, "da", api);
      fireEvent.click(screen.getByRole("radio", { name: "Alma" }));
      fireEvent.click(
        within(screen.getByRole("radiogroup", { name: "Lys eller mørk for Alma" })).getByRole(
          "radio",
          { name: "Mørk" },
        ),
      );
      await waitFor(() => {
        expect(calls).toEqual([
          { url: "/api/spaces/s1/settings/members/u-child", body: { theme: "dark" } },
        ]);
      });
      expect(document.documentElement.dataset.theme).toBeUndefined();
      expect(document.cookie).not.toContain("frejsi_theme");
    });

    it("shows the person's stored theme", () => {
      mount({
        ...data,
        me: { ...owner, theme: "light" },
        people: [{ ...owner, theme: "light" }, child, viewer],
      });
      expect(screen.getByRole("radio", { name: "Lys" })).toHaveAttribute("aria-checked", "true");
    });
  });

  it("does not know Dexcom", () => {
    const source = readFileSync(path.join(import.meta.dirname, "ColourScreen.tsx"), "utf8");
    expect(source).not.toMatch(/dexcom/i);
  });
});

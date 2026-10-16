import "@testing-library/jest-dom/vitest";

import type { SessionContext } from "@frejsi/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SettingsData } from "@/components/settings/load-settings";
import type { ShellData } from "@/components/shell/load-shell";
import { I18nProvider } from "@/lib/i18n/Provider";
import { getMessages } from "@/lib/i18n/messages";

const mocks = vi.hoisted(() => ({
  session: null as SessionContext | null,
  shell: null as ShellData | null,
  data: null as SettingsData | null,
  loadCalls: [] as unknown[],
}));
vi.mock("@/components/shell/shell-session", () => ({
  getShellSession: () => Promise.resolve(mocks.session),
  getShell: () => Promise.resolve(mocks.shell),
}));
vi.mock("@/components/settings/load-settings", () => ({
  loadSettingsData: (...args: unknown[]) => {
    mocks.loadCalls.push(args);
    return Promise.resolve(mocks.data);
  },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/da/settings",
  redirect: (href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import ColourPage from "./colour/page";
import SettingsPage from "./page";
import ImportPage from "./import/page";
import SourcePage from "./source/page";
import ConnectSourcePage from "./source/connect/page";

const params = Promise.resolve({ locale: "da" });

const session: SessionContext = {
  userId: "u-viewer",
  name: "Laerke",
  simpleMode: false,
  accent: "sea",
  theme: "system",
  locale: "da",
  memberships: [{ spaceId: "s1", role: "viewer" }],
};

const shellFor = (role: "owner" | "carer" | "viewer"): ShellData => ({
  space: {
    id: "s1",
    name: "Almas rum",
    role,
    timezone: "Europe/Copenhagen",
    subjectName: "Alma",
    ownerName: "Jonas",
  },
  spaces: [{ id: "s1", name: "Almas rum", role }],
});

const viewerData: SettingsData = {
  spaceId: "s1",
  spaceName: "Almas rum",
  subjectName: "Alma",
  timezone: "Europe/Copenhagen",
  role: "viewer",
  space: null,
  source: null,
  me: {
    userId: "u-viewer",
    name: "Laerke",
    role: "viewer",
    locale: "da",
    simpleMode: false,
    accent: "sea",
    theme: "system",
  },
  people: [
    {
      userId: "u-viewer",
      name: "Laerke",
      role: "viewer",
      locale: "da",
      simpleMode: false,
      accent: "sea",
      theme: "system",
    },
  ],
};

const mount = (tree: React.ReactNode) =>
  render(
    <I18nProvider locale="da" messages={getMessages("da")} timeZone="Europe/Copenhagen">
      {tree}
    </I18nProvider>,
  );

afterEach(() => {
  cleanup();
  mocks.session = null;
  mocks.shell = null;
  mocks.data = null;
  mocks.loadCalls.length = 0;
});

describe("settings pages (plan task 9)", () => {
  it("renders nothing without a session or a space: the layout handles both", async () => {
    expect(await SettingsPage({ params })).toBeNull();
    mocks.session = session;
    expect(await SettingsPage({ params })).toBeNull();
    expect(await ColourPage({ params })).toBeNull();
    expect(await ConnectSourcePage({ params, searchParams: Promise.resolve({}) })).toBeNull();
    expect(await SourcePage({ params })).toBeNull();
    expect(mocks.loadCalls).toEqual([]);
  });

  it("loads the data for the session and the chosen space and renders the viewer's settings without a space section", async () => {
    mocks.session = session;
    mocks.shell = shellFor("viewer");
    mocks.data = viewerData;
    const { container } = mount(await SettingsPage({ params }));
    expect(mocks.loadCalls).toEqual([[session, mocks.shell.space]]);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Indstillinger");
    expect(screen.queryByTestId("source-section")).toBeNull();
    expect(container.textContent).not.toMatch(/mmol|Glukosekilde/);
  });

  it("renders the Farve screen for the same data", async () => {
    mocks.session = session;
    mocks.shell = shellFor("viewer");
    mocks.data = viewerData;
    mount(await ColourPage({ params }));
    expect(screen.getByTestId("colour-preview")).toHaveAttribute("data-accent", "sea");
    expect(screen.queryByTestId("preview-reading")).toBeNull();
  });

  const ownerData = (type: "dexcom-share" | "nightscout" | "manual" | null): SettingsData => ({
    ...viewerData,
    role: "owner",
    source: {
      type,
      region: type === "dexcom-share" ? "us" : null,
      status: type ? "connected" : "not-configured",
      lastReadingAt: null,
      since: null,
    },
  });
  const asOwner = () => {
    mocks.session = { ...session, memberships: [{ spaceId: "s1", role: "owner" }] };
    mocks.shell = shellFor("owner");
  };
  const search = (type?: string) => Promise.resolve(type === undefined ? {} : { type });

  it("sends a non-owner from the connect form back to Settings without loading anything", async () => {
    mocks.session = session;
    mocks.shell = shellFor("carer");
    await expect(ConnectSourcePage({ params, searchParams: search("nightscout") })).rejects.toThrow(
      "NEXT_REDIRECT:/da/settings",
    );
    expect(mocks.loadCalls).toEqual([]);
  });

  it("gives an owner the connect form for the source in ?type=, with the configured region", async () => {
    asOwner();
    mocks.data = ownerData("dexcom-share");
    mount(await ConnectSourcePage({ params, searchParams: search("dexcom-share") }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Skift login");
    expect(screen.getByRole("radio", { name: "US" })).toBeChecked();
    cleanup();
    mocks.data = ownerData("dexcom-share");
    mount(await ConnectSourcePage({ params, searchParams: search("nightscout") }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Forbind Nightscout");
  });

  it("sends manual, an unknown type and no type to the source page", async () => {
    asOwner();
    mocks.data = ownerData(null);
    for (const type of ["manual", "ftp", undefined]) {
      await expect(ConnectSourcePage({ params, searchParams: search(type) })).rejects.toThrow(
        "NEXT_REDIRECT:/da/settings/source",
      );
    }
  });

  it("gives an owner the source page with the three cards and sends anyone else to Settings", async () => {
    asOwner();
    mocks.data = ownerData("nightscout");
    mount(await SourcePage({ params }));
    expect(screen.getByTestId("source-picker")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Glukosekilde");
    expect(screen.getByTestId("source-card")).toHaveTextContent("Nightscout");
    expect(screen.getByTestId("source-card-manual")).toBeInTheDocument();
    cleanup();

    mocks.loadCalls = [];
    mocks.session = session;
    mocks.shell = shellFor("carer");
    await expect(SourcePage({ params })).rejects.toThrow("NEXT_REDIRECT:/da/settings");
    mocks.shell = shellFor("viewer");
    await expect(SourcePage({ params })).rejects.toThrow("NEXT_REDIRECT:/da/settings");
    expect(mocks.loadCalls).toEqual([]);
  });
});

describe("ImportPage (#154)", () => {
  it("renders nothing without a session, sends a carer back to Settings and gives an owner the form", async () => {
    mocks.session = null;
    mocks.shell = null;
    expect(await ImportPage({ params })).toBeNull();

    mocks.session = { ...session, memberships: [{ spaceId: "s1", role: "carer" }] };
    mocks.shell = shellFor("carer");
    await expect(ImportPage({ params })).rejects.toThrow("NEXT_REDIRECT:/da/settings");

    mocks.session = { ...session, memberships: [{ spaceId: "s1", role: "owner" }] };
    mocks.shell = shellFor("owner");
    mount(await ImportPage({ params }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Importér fra Dexcom Clarity",
    );
    expect(screen.getByText("Tiderne i filen læses som Europe/Copenhagen.")).toBeInTheDocument();
  });
});

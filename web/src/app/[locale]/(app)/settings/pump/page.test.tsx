import "@testing-library/jest-dom/vitest";

import type { PumpSettingsView, SessionContext } from "@frejsi/shared";
import { cleanup, render, screen, within } from "@testing-library/react";
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
  usePathname: () => "/da/settings/pump",
  redirect: (href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`);
  },
}));

import PumpPage from "./page";

const params = Promise.resolve({ locale: "da" });

const sessionFor = (role: "owner" | "carer" | "viewer", simpleMode = false): SessionContext => ({
  userId: `u-${role}`,
  name: "Example",
  simpleMode,
  accent: "olive",
  theme: "system",
  locale: "da",
  memberships: [{ spaceId: "s1", role }],
});
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
const person = (role: "owner" | "carer") => ({
  userId: `u-${role}`,
  name: "Example",
  role,
  locale: "da" as const,
  simpleMode: false,
  accent: "olive" as const,
  theme: "system" as const,
});
const dataFor = (role: "owner" | "carer", pump: PumpSettingsView | null): SettingsData => ({
  spaceId: "s1",
  spaceName: "Almas rum",
  subjectName: "Alma",
  timezone: "Europe/Copenhagen",
  role,
  space: null,
  source: null,
  pump,
  me: person(role),
  people: [person(role)],
});

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

describe("settings/pump, the phone page behind the Pumpehistorik row (plan task 3)", () => {
  it("renders nothing without a session or a space: the layout handles both", async () => {
    expect(await PumpPage({ params })).toBeNull();
    expect(mocks.loadCalls).toEqual([]);
  });

  it("sends a simpleMode member to Nu and a viewer to Settings, before anything is loaded", async () => {
    mocks.session = sessionFor("carer", true);
    mocks.shell = shellFor("carer");
    await expect(PumpPage({ params })).rejects.toThrow("NEXT_REDIRECT:/da/now");
    mocks.session = sessionFor("viewer");
    mocks.shell = shellFor("viewer");
    await expect(PumpPage({ params })).rejects.toThrow("NEXT_REDIRECT:/da/settings");
    expect(mocks.loadCalls).toEqual([]);
  });

  it("sends back to Settings when the loader gave no pump record", async () => {
    mocks.session = sessionFor("owner");
    mocks.shell = shellFor("owner");
    mocks.data = dataFor("owner", null);
    await expect(PumpPage({ params })).rejects.toThrow("NEXT_REDIRECT:/da/settings");
  });

  it("gives an owner the card from load-settings with Forbind, under a back link to Settings", async () => {
    mocks.session = sessionFor("owner");
    mocks.shell = shellFor("owner");
    mocks.data = dataFor("owner", { status: "not-configured", configured: false });
    mount(await PumpPage({ params }));
    expect(mocks.loadCalls).toEqual([[mocks.session, mocks.shell.space]]);
    const page = screen.getByTestId("pump-page");
    expect(within(page).getByRole("heading", { level: 1 })).toHaveTextContent("Pumpehistorik");
    expect(within(page).getByRole("link", { name: /Tilbage|Indstillinger/ })).toHaveAttribute(
      "href",
      "/da/settings",
    );
    expect(screen.getByTestId("pump-status")).toHaveTextContent("Ikke forbundet");
    expect(screen.getByRole("button", { name: "Forbind" })).toBeVisible();
  });

  it("gives a carer the status without the form", async () => {
    mocks.session = sessionFor("carer");
    mocks.shell = shellFor("carer");
    mocks.data = dataFor("carer", {
      status: "disconnected",
      since: "2026-10-15T12:05:00.000Z",
      configured: true,
    });
    mount(await PumpPage({ params }));
    expect(screen.getByTestId("pump-status")).toHaveTextContent("Forbindelsen svigter siden");
    expect(within(screen.getByTestId("pump-card")).queryAllByRole("button")).toEqual([]);
  });
});

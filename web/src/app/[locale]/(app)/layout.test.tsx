import "@testing-library/jest-dom/vitest";

import type { SessionContext } from "@frejsi/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/lib/i18n/Provider";
import { getMessages } from "@/lib/i18n/messages";

const mocks = vi.hoisted(() => ({
  session: null as SessionContext | null,
  shell: null as { space: unknown; spaces: unknown[] } | null,
  spaceCookie: undefined as string | undefined,
  loadCalls: [] as unknown[],
}));
vi.mock("@/lib/auth/session", () => ({ getSession: () => Promise.resolve(mocks.session) }));
vi.mock("@/components/shell/load-shell", () => ({
  loadShellData: (...args: unknown[]) => {
    mocks.loadCalls.push(args);
    return Promise.resolve(mocks.shell);
  },
}));
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === "frejsi_space" && mocks.spaceCookie ? { value: mocks.spaceCookie } : undefined,
    }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/da/now",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  redirect: (href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`);
  },
}));
vi.mock("@/components/shell/actions", () => ({ switchSpace: vi.fn() }));

import AppLayout from "./layout";

const jonas: SessionContext = {
  userId: "u1",
  name: "Jonas",
  simpleMode: false,
  accent: "forest",
  locale: "da",
  memberships: [{ spaceId: "s1", role: "owner" }],
};

const params = Promise.resolve({ locale: "da" });

afterEach(() => {
  cleanup();
  mocks.session = null;
  mocks.shell = null;
  mocks.spaceCookie = undefined;
  mocks.loadCalls.length = 0;
});

describe("(app) layout (plan §6)", () => {
  it("renders nothing of the page for a null session and sends the browser to welcome in its locale", async () => {
    // A frejsi_session cookie whose row expired or was deleted passes the middleware's check.
    await expect(AppLayout({ children: <p>secret</p>, params })).rejects.toThrow(
      "NEXT_REDIRECT:/da/welcome",
    );
    expect(mocks.loadCalls).toEqual([]);
    await expect(
      AppLayout({ children: <p>secret</p>, params: Promise.resolve({ locale: "en" }) }),
    ).rejects.toThrow("NEXT_REDIRECT:/en/welcome");
  });

  it("renders the shell around the page for a session, with the device's chosen space", async () => {
    mocks.session = jonas;
    mocks.spaceCookie = "s1";
    mocks.shell = {
      space: {
        id: "s1",
        name: "Almas rum",
        role: "owner",
        timezone: "Europe/Copenhagen",
        subjectName: "Alma",
        ownerName: "Jonas",
      },
      spaces: [{ id: "s1", name: "Almas rum", role: "owner" }],
    };
    const tree = await AppLayout({ children: <p>page body</p>, params });
    render(
      <I18nProvider locale="da" messages={getMessages("da")}>
        {tree}
      </I18nProvider>,
    );
    expect(mocks.loadCalls[0]).toEqual([jonas, "s1"]);
    expect(screen.getByTestId("app-shell")).toHaveAttribute("data-accent", "forest");
    expect(screen.getByText("page body")).toBeInTheDocument();
    expect(screen.getByTestId("phone-tabs")).toBeInTheDocument();
  });

  it("tells a user who is in no space what to do, without a shell", async () => {
    mocks.session = jonas;
    mocks.shell = null;
    const tree = await AppLayout({ children: <p>page body</p>, params });
    render(
      <I18nProvider locale="da" messages={getMessages("da")}>
        {tree}
      </I18nProvider>,
    );
    expect(screen.getByText("Du er ikke med i et rum lige nu")).toBeInTheDocument();
    expect(screen.queryByText("page body")).toBeNull();
    expect(screen.queryByTestId("phone-tabs")).toBeNull();
  });
});

import "@testing-library/jest-dom/vitest";

import type { SessionContext } from "@frejsi/shared";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PeopleView } from "@/components/people/contract";
import { I18nProvider } from "@/lib/i18n/Provider";
import { getMessages } from "@/lib/i18n/messages";

const mocks = vi.hoisted(() => ({
  session: null as SessionContext | null,
  shell: null as {
    space: {
      id: string;
      name: string;
      role: "owner" | "carer" | "viewer";
      timezone: string;
      subjectName: string;
      ownerName: string | null;
    };
    spaces: unknown[];
  } | null,
  loadCalls: [] as string[],
}));
vi.mock("@/components/shell/shell-session", () => ({
  getShellSession: () => Promise.resolve(mocks.session),
  getShell: () => Promise.resolve(mocks.shell),
}));
vi.mock("@/components/people/load-people", () => ({
  loadPeople: (spaceId: string) => {
    mocks.loadCalls.push(spaceId);
    return Promise.resolve(view);
  },
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/da/people",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  redirect: (href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`);
  },
}));

import PeoplePage from "./page";

const view: PeopleView = {
  members: [
    {
      userId: "u1",
      name: "Jonas",
      role: "owner",
      simpleMode: false,
      lastSeen: null,
      devices: [],
    },
    {
      userId: "u2",
      name: "Alma",
      role: "carer",
      simpleMode: true,
      lastSeen: null,
      devices: [],
    },
  ],
  invites: [],
};

// Alma in the normal shell; with simpleMode on she has no Mere tab and the page sends her to Nu.
const alma: SessionContext = {
  userId: "u2",
  name: "Alma",
  simpleMode: false,
  accent: "plum",
  theme: "system",
  locale: "da",
  memberships: [{ spaceId: "s1", role: "carer" }],
};

const shellFor = (role: "owner" | "carer" | "viewer") => ({
  space: {
    id: "s1",
    name: "Almas rum",
    role,
    timezone: "Europe/Copenhagen",
    subjectName: "Alma",
    ownerName: "Jonas",
  },
  spaces: [],
});

const params = Promise.resolve({ locale: "da" });

afterEach(() => {
  cleanup();
  mocks.session = null;
  mocks.shell = null;
  mocks.loadCalls.length = 0;
});

describe("/[locale]/people (plan task 7)", () => {
  it("renders nothing without a session or a space: the layout is redirecting", async () => {
    expect(await PeoplePage({ params })).toBeNull();
    mocks.session = alma;
    expect(await PeoplePage({ params })).toBeNull();
    expect(mocks.loadCalls).toEqual([]);
  });

  it("loads the chosen space's people and renders the screen for the session's role", async () => {
    mocks.session = alma;
    mocks.shell = shellFor("carer");
    const tree = await PeoplePage({ params });
    render(
      <I18nProvider locale="da" messages={getMessages("da")}>
        {tree}
      </I18nProvider>,
    );
    expect(mocks.loadCalls).toEqual(["s1"]);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Personer i Almas rum");
    const [, almaRow] = screen.getAllByTestId("member-row");
    if (!almaRow) throw new Error("no second row");
    expect(within(almaRow).getByText("(dig)")).toBeInTheDocument();
    // A carer reads; the owner-only panel is not drawn.
    expect(screen.queryByTestId("invite-panel")).toBeNull();
  });

  it("sends a simpleMode member to Nu without loading the list: nothing administrative in the simple shell", async () => {
    mocks.session = { ...alma, simpleMode: true };
    mocks.shell = shellFor("carer");
    await expect(PeoplePage({ params })).rejects.toThrow("NEXT_REDIRECT:/da/now");
    mocks.session = { ...alma, simpleMode: true, memberships: [{ spaceId: "s1", role: "owner" }] };
    mocks.shell = shellFor("owner");
    await expect(PeoplePage({ params })).rejects.toThrow("NEXT_REDIRECT:/da/now");
    expect(mocks.loadCalls).toEqual([]);
  });

  it("keeps the list for a viewer with simpleMode set: the viewer shell has a Mere tab", async () => {
    mocks.session = { ...alma, simpleMode: true, memberships: [{ spaceId: "s1", role: "viewer" }] };
    mocks.shell = shellFor("viewer");
    expect(await PeoplePage({ params })).not.toBeNull();
    expect(mocks.loadCalls).toEqual(["s1"]);
  });
});

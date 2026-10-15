import type { Role, SessionContext } from "@frejsi/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: null as SessionContext | null,
  role: null as Role | null,
}));
vi.mock("@/components/shell/shell-session", () => ({
  getShellSession: () => Promise.resolve(mocks.session),
  getShell: () =>
    Promise.resolve(mocks.role ? { space: { id: "s1", role: mocks.role }, spaces: [] } : null),
}));
vi.mock("next/navigation", () => ({
  redirect: (href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`);
  },
}));

import LocaleIndex from "./page";

const user = (locale: SessionContext["locale"]): SessionContext => ({
  userId: "u1",
  name: "Jonas",
  simpleMode: false,
  accent: "forest",
  locale,
  memberships: [{ spaceId: "s1", role: "owner" }],
});

const open = (locale: string) => LocaleIndex({ params: Promise.resolve({ locale }) });

afterEach(() => {
  mocks.session = null;
  mocks.role = null;
});

describe("the locale index (plan §6)", () => {
  it("sends a visitor without a session to welcome in the URL's locale", async () => {
    await expect(open("da")).rejects.toThrow("NEXT_REDIRECT:/da/welcome");
    await expect(open("en")).rejects.toThrow("NEXT_REDIRECT:/en/welcome");
  });

  it("lands on the role's home: Nu for owners and carers, I dag for a viewer, Nu without a space", async () => {
    mocks.session = user("da");
    mocks.role = "owner";
    await expect(open("da")).rejects.toThrow("NEXT_REDIRECT:/da/now");
    mocks.role = "viewer";
    await expect(open("da")).rejects.toThrow("NEXT_REDIRECT:/da/today");
    mocks.role = null;
    await expect(open("da")).rejects.toThrow("NEXT_REDIRECT:/da/now");
  });

  it("lands in the user's own language, whatever the browser or the cookie made the middleware pick", async () => {
    // An English user opens the installed app on a new device with a Danish browser.
    mocks.session = user("en");
    mocks.role = "carer";
    await expect(open("da")).rejects.toThrow("NEXT_REDIRECT:/en/now");
    mocks.session = user("da");
    await expect(open("en")).rejects.toThrow("NEXT_REDIRECT:/da/now");
  });
});

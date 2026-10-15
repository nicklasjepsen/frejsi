import type { SessionContext } from "@frejsi/shared";
import { isValidElement, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: null as SessionContext | null,
  shell: null as { space: { id: string; role: "owner" | "carer" | "viewer" } } | null,
}));
vi.mock("@/components/shell/shell-session", () => ({
  getShellSession: () => Promise.resolve(mocks.session),
  getShell: () => Promise.resolve(mocks.shell),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));
vi.mock("@/components/library/LibraryScreen", () => ({ LibraryScreen: () => null }));
vi.mock("@/components/library/FoodEditScreen", () => ({ FoodEditScreen: () => null }));

import FoodPage from "./[foodId]/page";
import NewFoodPage from "./new/page";
import LibraryPage from "./page";

const session = (simpleMode: boolean, role: "owner" | "carer" | "viewer"): SessionContext => ({
  userId: "u1",
  name: "Example Carer",
  simpleMode,
  accent: "olive",
  locale: "da",
  memberships: [{ spaceId: "s1", role }],
});
const as = (simpleMode: boolean, role: "owner" | "carer" | "viewer") => {
  mocks.session = session(simpleMode, role);
  mocks.shell = { space: { id: "s1", role } };
};
const params = Promise.resolve({ locale: "da" });
const foodParams = Promise.resolve({ locale: "da", foodId: "f-rye" });
const pages = [
  () => LibraryPage({ params }),
  () => NewFoodPage({ params }),
  () => FoodPage({ params: foodParams }),
];

afterEach(() => {
  mocks.session = null;
  mocks.shell = null;
});

describe("/[locale]/library and its phone pages (plan task 5)", () => {
  it("renders nothing while the layout redirects (no session or no space)", async () => {
    for (const page of pages) expect(await page()).toBeNull();
  });

  it("sends a viewer to their day: the library is never theirs", async () => {
    as(false, "viewer");
    for (const page of pages) await expect(page()).rejects.toThrow("redirect:/da/today");
  });

  it("sends a simpleMode session to Nu: the library is not in the simple shell", async () => {
    as(true, "carer");
    for (const page of pages) await expect(page()).rejects.toThrow("redirect:/da/now");
  });

  it("renders the screens for an owner or a carer with the space and the food id", async () => {
    as(false, "carer");
    const [list, created, edited] = (await Promise.all(
      pages.map((page) => page()),
    )) as ReactElement<Record<string, unknown>>[];
    expect(isValidElement(list)).toBe(true);
    expect(list?.props).toEqual({ spaceId: "s1", locale: "da", initialFilter: "all" });
    expect(created?.props).toEqual({ spaceId: "s1", locale: "da" });
    expect(edited?.props).toEqual({ spaceId: "s1", locale: "da", foodId: "f-rye" });
  });
});

describe("library filter search parameter (#122)", () => {
  it.each(["all", "unverified", "own", "favourites", "recent", "off", "frida", "future-source"])(
    "passes the valid filter %s to the screen",
    async (filter) => {
      as(false, "owner");
      const page = (await LibraryPage({
        params,
        searchParams: Promise.resolve({ filter }),
      })) as ReactElement<Record<string, unknown>>;
      expect(page.props.initialFilter).toBe(filter);
    },
  );

  it.each([
    undefined,
    "",
    "UNKNOWN",
    " unverified",
    "unverified ",
    "off/source",
    "a".repeat(21),
    ["unverified"],
    ["unverified", "all"],
  ])("falls back to all for a missing or malformed filter %j", async (filter) => {
    as(false, "carer");
    const page = (await LibraryPage({
      params,
      searchParams: Promise.resolve({ filter }),
    })) as ReactElement<Record<string, unknown>>;
    expect(page.props.initialFilter).toBe("all");
  });

  it.each([
    { simpleMode: false, role: "viewer" as const, target: "/da/today" },
    { simpleMode: true, role: "carer" as const, target: "/da/now" },
  ])("keeps the redirect to $target with a filter", async ({ simpleMode, role, target }) => {
    as(simpleMode, role);
    await expect(
      LibraryPage({
        params,
        searchParams: Promise.resolve({ filter: "unverified" }),
      }),
    ).rejects.toThrow(`redirect:${target}`);
  });
});

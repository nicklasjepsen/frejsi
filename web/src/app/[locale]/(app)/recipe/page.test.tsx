import "@testing-library/jest-dom/vitest";

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
vi.mock("@/components/recipes/RecipeScreen", () => ({ RecipeScreen: () => null }));

import EditRecipePage from "./[foodId]/page";
import NewRecipePage from "./new/page";

const session = (simpleMode: boolean, role: "owner" | "carer" | "viewer"): SessionContext => ({
  userId: "u1",
  name: "Example Carer",
  simpleMode,
  accent: "olive",
  theme: "system",
  locale: "da",
  memberships: [{ spaceId: "s1", role }],
});
const as = (simpleMode: boolean, role: "owner" | "carer" | "viewer") => {
  mocks.session = session(simpleMode, role);
  mocks.shell = { space: { id: "s1", role } };
};
const params = Promise.resolve({ locale: "da" });
const pages = [
  () => NewRecipePage({ params }),
  () => NewRecipePage({ params, searchParams: Promise.resolve({ meal: "m1", share: ["x"] }) }),
  () => EditRecipePage({ params: Promise.resolve({ locale: "da", foodId: "f-dish" }) }),
];

afterEach(() => {
  mocks.session = null;
  mocks.shell = null;
});

describe("/[locale]/recipe/new and /recipe/[foodId] (the library's access)", () => {
  it("renders nothing while the layout redirects", async () => {
    for (const page of pages) expect(await page()).toBeNull();
  });
  it("sends a viewer to their day and a simpleMode session to Nu: verified foods only there", async () => {
    as(false, "viewer");
    for (const page of pages) await expect(page()).rejects.toThrow("redirect:/da/today");
    as(true, "carer");
    for (const page of pages) await expect(page()).rejects.toThrow("redirect:/da/now");
  });
  it("renders the screen for an owner or a carer with the meal, the share or the food id", async () => {
    as(false, "owner");
    const [plain, withQuery, edit] = (await Promise.all(
      pages.map((page) => page()),
    )) as ReactElement<Record<string, unknown>>[];
    expect(isValidElement(plain)).toBe(true);
    expect(plain?.props).toEqual({
      spaceId: "s1",
      locale: "da",
      mealId: undefined,
      shareId: undefined,
    });
    expect(withQuery?.props).toEqual({
      spaceId: "s1",
      locale: "da",
      mealId: "m1",
      shareId: undefined,
    });
    expect(edit?.props).toEqual({ spaceId: "s1", locale: "da", foodId: "f-dish" });
  });
});

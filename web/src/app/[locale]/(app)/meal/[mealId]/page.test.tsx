import type { SessionContext } from "@frejsi/shared";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MealDetail, SimpleMealView } from "@/components/meal-detail";

const mocks = vi.hoisted(() => ({
  session: null as SessionContext | null,
  shell: null as { space: { id: string; role: string; timezone: string } } | null,
  unitCalls: [] as string[],
}));
vi.mock("@frejsi/shared", async (actual) => ({
  ...(await actual<object>()),
  prisma: { space: { findUnique: () => Promise.resolve({ aiEnabled: true }) } },
}));
vi.mock("@/components/shell/shell-session", () => ({
  getShellSession: () => Promise.resolve(mocks.session),
  getShell: () => Promise.resolve(mocks.shell),
}));
vi.mock("./space-unit", () => ({
  loadSpaceUnit: (spaceId: string) => {
    mocks.unitCalls.push(spaceId);
    return Promise.resolve("mgdl");
  },
}));
vi.mock("next/navigation", () => ({
  redirect: (href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`);
  },
}));
import MealPage from "./page";
import type { loadSpaceUnit } from "./space-unit";

const jonas: SessionContext = {
  userId: "u-jonas",
  name: "Jonas",
  simpleMode: false,
  accent: "olive",
  theme: "system",
  locale: "da",
  memberships: [{ spaceId: "s1", role: "owner" }],
};
const params = Promise.resolve({ locale: "da", mealId: "m1" });
const withEdit = Promise.resolve({ edit: "1" });
const space = (role: string) => ({ space: { id: "s1", role, timezone: "Europe/Copenhagen" } });

afterEach(() => {
  mocks.session = null;
  mocks.shell = null;
  mocks.unitCalls.length = 0;
});

describe("/[locale]/meal/[mealId]", () => {
  it("renders meal detail for an owner or carer with the space's zone and unit", async () => {
    for (const role of ["owner", "carer"]) {
      mocks.session = jonas;
      mocks.shell = space(role);
      const tree = (await MealPage({ params })) as ReactElement<Record<string, unknown>>;
      expect(tree.type).toBe(MealDetail);
      expect(tree.props).toEqual({
        spaceId: "s1",
        mealId: "m1",
        locale: "da",
        timeZone: "Europe/Copenhagen",
        unit: "mgdl",
        aiEnabled: true,
        edit: false,
      });
    }
  });

  it("opens the edit sheet for an owner or carer on ?edit=1, and on nothing else", async () => {
    for (const role of ["owner", "carer"]) {
      mocks.session = jonas;
      mocks.shell = space(role);
      const tree = (await MealPage({ params, searchParams: withEdit })) as ReactElement<
        Record<string, unknown>
      >;
      expect(tree.type).toBe(MealDetail);
      expect(tree.props).toMatchObject({ mealId: "m1", edit: true });
    }
    mocks.session = jonas;
    mocks.shell = space("owner");
    const other = (await MealPage({
      params,
      searchParams: Promise.resolve({ edit: "yes" }),
    })) as ReactElement<Record<string, unknown>>;
    expect(other.props).toMatchObject({ edit: false });
  });

  it("redirects a viewer on ?edit=1 exactly as without it, before reading anything", async () => {
    mocks.session = { ...jonas, memberships: [{ spaceId: "s1", role: "viewer" }] };
    mocks.shell = space("viewer");
    await expect(MealPage({ params, searchParams: withEdit })).rejects.toThrow(
      "NEXT_REDIRECT:/da/today",
    );
    expect(mocks.unitCalls).toEqual([]);
  });

  it("ignores ?edit=1 for a simpleMode session: the simple view, with no edit at all", async () => {
    mocks.session = { ...jonas, simpleMode: true };
    mocks.shell = space("owner");
    const tree = (await MealPage({ params, searchParams: withEdit })) as ReactElement<
      Record<string, unknown>
    >;
    expect(tree.type).toBe(SimpleMealView);
    expect(tree.props).toEqual({
      spaceId: "s1",
      mealId: "m1",
      locale: "da",
      timeZone: "Europe/Copenhagen",
    });
    expect(mocks.unitCalls).toEqual([]);
  });

  it("redirects a viewer to today before reading anything", async () => {
    mocks.session = { ...jonas, memberships: [{ spaceId: "s1", role: "viewer" }] };
    mocks.shell = space("viewer");
    await expect(MealPage({ params })).rejects.toThrow("NEXT_REDIRECT:/da/today");
    expect(mocks.unitCalls).toEqual([]);
  });

  it("gives a simpleMode session the simple view, without the unit or any glucose", async () => {
    mocks.session = { ...jonas, simpleMode: true };
    mocks.shell = space("carer");
    const tree = (await MealPage({ params })) as ReactElement<Record<string, unknown>>;
    expect(tree.type).toBe(SimpleMealView);
    expect(tree.props).toEqual({
      spaceId: "s1",
      mealId: "m1",
      locale: "da",
      timeZone: "Europe/Copenhagen",
    });
    expect(mocks.unitCalls).toEqual([]);
  });

  it("renders nothing without a session or a space (the layout has already redirected)", async () => {
    expect(await MealPage({ params })).toBeNull();
  });
});

describe("loadSpaceUnit", () => {
  it("reads the one column, and falls back to mmol for an unknown value", async () => {
    const { loadSpaceUnit: real } = await vi.importActual<{ loadSpaceUnit: typeof loadSpaceUnit }>(
      "./space-unit",
    );
    const queries: unknown[] = [];
    const db = (glucoseUnit: string | null) => ({
      space: {
        findUnique: (query: unknown) => {
          queries.push(query);
          return Promise.resolve(glucoseUnit === null ? null : { glucoseUnit });
        },
      },
    });
    expect(await real("s1", db("mgdl") as never)).toBe("mgdl");
    expect(await real("s1", db("mmol") as never)).toBe("mmol");
    expect(await real("s1", db(null) as never)).toBe("mmol");
    expect(queries[0]).toEqual({ where: { id: "s1" }, select: { glucoseUnit: true } });
  });
});

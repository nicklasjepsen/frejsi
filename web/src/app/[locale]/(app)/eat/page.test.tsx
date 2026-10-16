import type { SessionContext } from "@frejsi/shared";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SimplePicker, type SimplePickerProps } from "@/components/simple/SimplePicker";

const mocks = vi.hoisted(() => ({
  session: null as SessionContext | null,
  shell: null as { space: { id: string; role: string; timezone: string } } | null,
}));
vi.mock("@/components/shell/shell-session", () => ({
  getShellSession: () => Promise.resolve(mocks.session),
  getShell: () => Promise.resolve(mocks.shell),
}));
vi.mock("next/navigation", () => ({
  redirect: (href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`);
  },
  useRouter: () => ({ push: vi.fn() }),
}));
import EatPage from "./page";

const alma: SessionContext = {
  userId: "u-alma",
  name: "Alma",
  simpleMode: true,
  accent: "plum",
  theme: "system",
  locale: "da",
  memberships: [{ spaceId: "s1", role: "carer" }],
};
const space = (role: string) => ({ space: { id: "s1", role, timezone: "Europe/Copenhagen" } });
const params = Promise.resolve({ locale: "da" });
const open = (search: Record<string, string> = {}) =>
  EatPage({ params, searchParams: Promise.resolve(search) });

afterEach(() => {
  mocks.session = null;
  mocks.shell = null;
});

describe("/[locale]/eat", () => {
  it("gives a simpleMode session the picker at the simple sizes", async () => {
    mocks.session = alma;
    mocks.shell = space("carer");
    const tree = (await open()) as ReactElement<SimplePickerProps>;
    expect(tree.type).toBe(SimplePicker);
    expect(tree.props).toEqual({
      spaceId: "s1",
      locale: "da",
      simple: true,
      initialFoodId: undefined,
    });
  });

  it("gives any other session the same picker without the simple sizes, with ?food= selected", async () => {
    mocks.session = { ...alma, simpleMode: false };
    mocks.shell = space("owner");
    const tree = (await open({ food: "f-pack" })) as ReactElement<SimplePickerProps>;
    expect(tree.props).toMatchObject({ simple: false, initialFoodId: "f-pack" });
  });

  it("sends a viewer to their day: a viewer never logs a meal", async () => {
    mocks.session = { ...alma, simpleMode: false };
    mocks.shell = space("viewer");
    await expect(open()).rejects.toThrow("NEXT_REDIRECT:/da/today");
  });

  it("renders nothing without a session or a space (the layout has already redirected)", async () => {
    expect(await open()).toBeNull();
  });
});

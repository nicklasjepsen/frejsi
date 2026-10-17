import type { SessionContext } from "@frejsi/shared";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SymptomPicker, type SymptomPickerProps } from "@/components/symptoms/SymptomPicker";

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
import FeelPage from "./page";

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
const open = () => FeelPage({ params: Promise.resolve({ locale: "da" }) });

afterEach(() => {
  mocks.session = null;
  mocks.shell = null;
});

describe("/[locale]/feel", () => {
  it("gives a simpleMode session the picker at the simple sizes, in the space's zone", async () => {
    mocks.session = alma;
    mocks.shell = space("carer");
    const tree = (await open()) as ReactElement<SymptomPickerProps>;
    expect(tree.type).toBe(SymptomPicker);
    expect(tree.props).toEqual({
      spaceId: "s1",
      locale: "da",
      simple: true,
      timeZone: "Europe/Copenhagen",
    });
  });
  it("gives an owner or carer the full picker", async () => {
    mocks.session = { ...alma, simpleMode: false };
    mocks.shell = space("owner");
    const tree = (await open()) as ReactElement<SymptomPickerProps>;
    expect(tree.props).toMatchObject({ simple: false });
  });
  it("sends a viewer to their day: a viewer never logs", async () => {
    mocks.session = { ...alma, simpleMode: false };
    mocks.shell = space("viewer");
    await expect(open()).rejects.toThrow("NEXT_REDIRECT:/da/today");
  });
  it("renders nothing without a session or a space", async () => {
    expect(await open()).toBeNull();
  });
});

import type { SessionContext } from "@frejsi/shared";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LogScreen, type LogScreenProps } from "./LogScreen";

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
import LogPage from "./page";

const jonas: SessionContext = {
  userId: "u-jonas",
  name: "Jonas",
  simpleMode: false,
  accent: "olive",
  locale: "da",
  memberships: [{ spaceId: "s1", role: "carer" }],
};
const space = (role: string) => ({ space: { id: "s1", role, timezone: "Europe/Copenhagen" } });
const params = Promise.resolve({ locale: "da" });
const open = (search: Record<string, string> = {}) =>
  LogPage({ params, searchParams: Promise.resolve(search) });

afterEach(() => {
  mocks.session = null;
  mocks.shell = null;
});

describe("/[locale]/log", () => {
  it("renders the log screen for an owner or carer with ?q= and ?barcode=", async () => {
    mocks.session = jonas;
    mocks.shell = space("carer");
    const tree = (await open({
      q: "rye",
      barcode: "2000000000015",
    })) as ReactElement<LogScreenProps>;
    expect(tree.type).toBe(LogScreen);
    expect(tree.props).toEqual({
      spaceId: "s1",
      locale: "da",
      timeZone: "Europe/Copenhagen",
      userName: "Jonas",
      simpleMode: false,
      initialQuery: "rye",
      initialBarcode: "2000000000015",
    });
  });

  it("redirects an old ?meal= link to meal detail, encoding the id", async () => {
    mocks.session = jonas;
    mocks.shell = space("carer");
    await expect(open({ meal: "m1" })).rejects.toThrow("NEXT_REDIRECT:/da/meal/m1");
    await expect(open({ meal: "m/2" })).rejects.toThrow("NEXT_REDIRECT:/da/meal/m%2F2");
  });

  it("sends a simpleMode session to the picker, with or without ?meal=", async () => {
    mocks.session = { ...jonas, simpleMode: true };
    mocks.shell = space("owner");
    await expect(open()).rejects.toThrow("NEXT_REDIRECT:/da/eat");
    await expect(open({ meal: "m1" })).rejects.toThrow("NEXT_REDIRECT:/da/eat");
  });

  it("sends a viewer to their own day", async () => {
    mocks.session = { ...jonas, memberships: [{ spaceId: "s1", role: "viewer" }] };
    mocks.shell = space("viewer");
    await expect(open()).rejects.toThrow("NEXT_REDIRECT:/da/today");
  });

  it("renders nothing without a session or a space (the layout has already redirected)", async () => {
    expect(await open()).toBeNull();
  });
});

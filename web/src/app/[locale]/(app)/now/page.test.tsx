import type { SessionContext } from "@frejsi/shared";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NowScreen, type NowScreenProps } from "./NowScreen";

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
}));
import NowPage from "./page";

const alma: SessionContext = {
  userId: "u-alma",
  name: "Alma",
  simpleMode: true,
  accent: "plum",
  locale: "da",
  memberships: [{ spaceId: "s1", role: "carer" }],
};
const params = Promise.resolve({ locale: "da" });

afterEach(() => {
  mocks.session = null;
  mocks.shell = null;
});

describe("/[locale]/now", () => {
  it("renders the screen for the shell's space with the user's simpleMode and the space's zone", async () => {
    mocks.session = alma;
    mocks.shell = { space: { id: "s1", role: "carer", timezone: "Europe/Copenhagen" } };
    const tree = (await NowPage({ params })) as ReactElement<NowScreenProps>;
    expect(tree.type).toBe(NowScreen);
    expect(tree.props).toEqual({
      spaceId: "s1",
      locale: "da",
      simpleMode: true,
      timeZone: "Europe/Copenhagen",
      role: "carer",
      aiEnabled: false,
      aiProvider: null,
    });
  });

  it("sends a viewer to their own landing instead of an empty Nu", async () => {
    mocks.session = { ...alma, memberships: [{ spaceId: "s1", role: "viewer" }] };
    mocks.shell = { space: { id: "s1", role: "viewer", timezone: "Europe/Copenhagen" } };
    await expect(NowPage({ params })).rejects.toThrow("NEXT_REDIRECT:/da/today");
  });

  it("renders nothing without a session or a space (the layout has already redirected)", async () => {
    expect(await NowPage({ params })).toBeNull();
  });
});

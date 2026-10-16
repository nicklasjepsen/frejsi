import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TodayScreen, type TodayScreenProps } from "./TodayScreen";

const mocks = vi.hoisted(() => ({
  shell: null as { space: { id: string; role: string; timezone: string } } | null,
}));
vi.mock("@/components/shell/shell-session", () => ({
  getShell: () => Promise.resolve(mocks.shell),
}));
import TodayPage from "./page";

const params = Promise.resolve({ locale: "da" });
afterEach(() => {
  mocks.shell = null;
});

describe("/[locale]/today", () => {
  it.each(["viewer", "carer", "owner"])(
    "renders the day for a %s of the shell's space",
    async (role) => {
      mocks.shell = { space: { id: "s1", role, timezone: "Europe/Copenhagen" } };
      const tree = (await TodayPage({ params })) as ReactElement<TodayScreenProps>;
      expect(tree.type).toBe(TodayScreen);
      expect(tree.props).toEqual({ spaceId: "s1", locale: "da", role });
    },
  );

  it("renders nothing without a space (the layout has already redirected)", async () => {
    expect(await TodayPage({ params })).toBeNull();
  });
});

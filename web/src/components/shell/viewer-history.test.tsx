import type { ReactElement } from "react";
import { expect, it, vi } from "vitest";
import { ViewerDays } from "@/components/history/ViewerDays";

const stored = vi.hoisted(() => ({
  userId: "u-alma",
  name: "Alma",
  simpleMode: true,
  accent: "plum",
  theme: "system",
  locale: "da",
  memberships: [{ spaceId: "s1", role: "viewer" }],
}));
vi.mock("@/lib/auth/session", () => ({ getSession: () => Promise.resolve(stored) }));
vi.mock("./load-shell", () => ({
  loadShellData: () =>
    Promise.resolve({
      space: { id: "s1", role: "viewer", timezone: "Europe/Copenhagen" },
      spaces: [],
    }),
}));
vi.mock("next/headers", () => ({ cookies: () => Promise.resolve({ get: () => undefined }) }));
vi.mock("next/navigation", () => ({
  redirect: (href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`);
  },
}));
import HistoryPage from "@/app/[locale]/(app)/history/page";

it("opens meal-only history for a viewer with simpleMode stored on their account", async () => {
  const tree = (await HistoryPage({
    params: Promise.resolve({ locale: "da" }),
    searchParams: Promise.resolve({}),
  })) as ReactElement<{ spaceId: string }>;
  expect(tree.type).toBe(ViewerDays);
  expect(tree.props.spaceId).toBe("s1");
  expect(stored.simpleMode).toBe(true);
});

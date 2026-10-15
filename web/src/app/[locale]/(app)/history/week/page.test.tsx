import type { ReactElement } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import type { HistoryWeekScreenProps } from "@/components/history-week/HistoryWeekScreen";

const mocks = vi.hoisted(() => ({
  session: { simpleMode: false },
  shell: { space: { id: "s1", role: "carer", timezone: "Europe/Copenhagen" } },
  findUnique: vi.fn(() => Promise.resolve({ glucoseUnit: "mgdl" })),
}));
vi.mock("@/components/shell/shell-session", () => ({
  getShellSession: () => Promise.resolve(mocks.session),
  getShell: () => Promise.resolve(mocks.shell),
}));
vi.mock("@frejsi/shared", () => ({ prisma: { space: { findUnique: mocks.findUnique } } }));
vi.mock("next/navigation", () => ({
  redirect: (href: string) => {
    throw new Error(`redirect:${href}`);
  },
}));
import Page from "./page";
const props = {
  params: Promise.resolve({ locale: "en" }),
  searchParams: Promise.resolve({ start: "2026-10-14", view: "maaltider" }),
};
beforeEach(() => {
  mocks.session.simpleMode = false;
  mocks.shell.space.role = "carer";
  mocks.findUnique.mockClear();
});
it("redirects a viewer before loading glucose or mounting the screen", async () => {
  mocks.shell.space.role = "viewer";
  await expect(Page(props)).rejects.toThrow("redirect:/en/history");
  expect(mocks.findUnique).not.toHaveBeenCalled();
});
it("redirects simpleMode to Now", async () => {
  mocks.session.simpleMode = true;
  await expect(Page(props)).rejects.toThrow("redirect:/en/now");
  expect(mocks.findUnique).not.toHaveBeenCalled();
});
it("passes the space's unit and normalized week to the screen", async () => {
  const tree = (await Page(props)) as ReactElement<HistoryWeekScreenProps>;
  expect(tree.props).toMatchObject({
    spaceId: "s1",
    locale: "en",
    unit: "mgdl",
    start: "2026-10-12",
    view: "maaltider",
  });
});

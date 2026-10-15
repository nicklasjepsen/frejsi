import type { ReactElement } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { HistoryScreen } from "@/components/history/HistoryScreen";
import { ViewerDays } from "@/components/history/ViewerDays";
const fake = vi.hoisted(() => ({
  role: "owner",
  simpleMode: false,
  unit: "mgdl",
  space: true,
  query: vi.fn(),
}));
vi.mock("@/components/shell/shell-session", () => ({
  getShellSession: () => Promise.resolve({ simpleMode: fake.simpleMode }),
  getShell: () =>
    Promise.resolve(
      fake.space ? { space: { id: "s1", role: fake.role, timezone: "Europe/Copenhagen" } } : null,
    ),
}));
vi.mock("@frejsi/shared", () => ({ prisma: { space: { findUnique: fake.query } } }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));
import Page from "./page";
const params = Promise.resolve({ locale: "da" });
beforeEach(() => {
  fake.role = "owner";
  fake.simpleMode = false;
  fake.space = true;
  fake.query.mockReset().mockResolvedValue({ glucoseUnit: fake.unit });
});
it.each(["owner", "carer"])(
  "loads history for %s and honours the date and space unit",
  async (role) => {
    fake.role = role;
    const tree = (await Page({
      params,
      searchParams: Promise.resolve({ date: "2026-10-13" }),
    })) as ReactElement<{ initialDate: string; unit: string }>;
    expect(tree.type).toBe(HistoryScreen);
    expect(tree.props.initialDate).toBe("2026-10-13");
    expect(tree.props.unit).toBe("mgdl");
  },
);
it("selects the viewer meal-only screen without reading glucose preferences", async () => {
  fake.role = "viewer";
  const tree = (await Page({ params, searchParams: Promise.resolve({}) })) as ReactElement;
  expect(tree.type).toBe(ViewerDays);
  expect(fake.query).not.toHaveBeenCalled();
});
it("redirects simpleMode to Now", async () => {
  fake.simpleMode = true;
  await expect(Page({ params, searchParams: Promise.resolve({}) })).rejects.toThrow(
    "redirect:/da/now",
  );
});
it("renders nothing without a shell", async () => {
  fake.space = false;
  expect(await Page({ params, searchParams: Promise.resolve({}) })).toBeNull();
});
it.each(["bad", "2026-02-30", "2999-01-01"])(
  "falls back to today for invalid or future date %s",
  async (date) => {
    const tree = (await Page({ params, searchParams: Promise.resolve({ date }) })) as ReactElement<{
      initialDate: string;
      today: string;
    }>;
    expect(tree.props.initialDate).toBe(tree.props.today);
  },
);

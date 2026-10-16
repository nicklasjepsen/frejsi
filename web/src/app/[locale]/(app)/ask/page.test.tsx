import type { SessionContext } from "@frejsi/shared";
import { afterEach, expect, it, vi } from "vitest";
import { AskFlow } from "@/components/estimate/AskFlow";

const mocks = vi.hoisted(() => ({ session: null as SessionContext | null, role: "carer" }));
vi.mock("@/components/shell/shell-session", () => ({
  getShellSession: () => Promise.resolve(mocks.session),
  getShell: () => Promise.resolve(mocks.session ? { space: { id: "s1", role: mocks.role } } : null),
}));
vi.mock("next/navigation", () => ({
  redirect: (href: string) => {
    throw new Error(href);
  },
}));
import AskPage from "./page";
const actor: SessionContext = {
  userId: "u1",
  name: "Example",
  simpleMode: true,
  accent: "olive",
  locale: "en",
  memberships: [{ spaceId: "s1", role: "carer" }],
};
afterEach(() => {
  mocks.session = null;
  mocks.role = "carer";
});
it("gives a member the ask flow, and returns nothing without a session", async () => {
  expect(await AskPage({ params: Promise.resolve({ locale: "en" }) })).toBeNull();
  mocks.session = actor;
  const element = await AskPage({ params: Promise.resolve({ locale: "en" }) });
  expect(element?.type).toBe(AskFlow);
  expect(element?.props).toEqual({ spaceId: "s1", locale: "en", simple: true });
});
it("redirects a viewer before rendering a capture control", async () => {
  mocks.session = actor;
  mocks.role = "viewer";
  await expect(AskPage({ params: Promise.resolve({ locale: "en" }) })).rejects.toThrow("/en/today");
});

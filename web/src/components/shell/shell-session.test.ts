import { readFileSync } from "node:fs";
import path from "node:path";

import type { SessionContext } from "@frejsi/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: null as SessionContext | null,
  sessionCalls: 0,
  spaceCookie: undefined as string | undefined,
  spaceRole: undefined as "owner" | "carer" | "viewer" | undefined,
  loadCalls: [] as unknown[],
}));
vi.mock("@/lib/auth/session", () => ({
  getSession: () => {
    mocks.sessionCalls += 1;
    return Promise.resolve(mocks.session);
  },
}));
vi.mock("@/components/shell/load-shell", () => ({
  loadShellData: (...args: unknown[]) => {
    mocks.loadCalls.push(args);
    return Promise.resolve({
      space: {
        id: mocks.spaceCookie ?? "s1",
        ...(mocks.spaceRole ? { role: mocks.spaceRole } : {}),
      },
      spaces: [],
    });
  },
}));
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === "frejsi_space" && mocks.spaceCookie ? { value: mocks.spaceCookie } : undefined,
    }),
}));

import { getShell, getShellSession } from "./shell-session";

const jonas: SessionContext = {
  userId: "u1",
  name: "Jonas",
  simpleMode: false,
  accent: "forest",
  theme: "system",
  locale: "da",
  memberships: [{ spaceId: "s1", role: "owner" }],
};

afterEach(() => {
  mocks.session = null;
  mocks.sessionCalls = 0;
  mocks.spaceCookie = undefined;
  mocks.spaceRole = undefined;
  mocks.loadCalls.length = 0;
});

const appDir = path.resolve(import.meta.dirname, "../../app/[locale]");
const source = (file: string) => readFileSync(path.join(appDir, file), "utf8");

describe("shell-session (one session load per request)", () => {
  it("getShellSession hands out the request's session", async () => {
    mocks.session = jonas;
    expect(await getShellSession()).toEqual(jonas);
    expect(mocks.sessionCalls).toBe(1);
  });

  it("getShell loads the shell for the session and the device's chosen space, null without a session", async () => {
    expect(await getShell()).toBeNull();
    expect(mocks.loadCalls).toEqual([]);
    mocks.session = jonas;
    mocks.spaceCookie = "s1";
    expect(await getShell()).toEqual({ space: { id: "s1" }, spaces: [] });
    expect(mocks.loadCalls).toEqual([[jonas, "s1"]]);
  });

  it("both accessors are wrapped in React cache, so a layout and its page share one load", () => {
    const self = readFileSync(path.join(import.meta.dirname, "shell-session.ts"), "utf8");
    expect(self).toMatch(/import \{ cache \} from "react"/);
    expect(self).toMatch(/export const getShellSession = cache\(/);
    expect(self).toMatch(/export const getShell = cache\(/);
  });

  it("the (app) layout, the locale index and the placeholder pages use the accessors, never getSession or loadShellData directly", () => {
    for (const file of [
      "(app)/layout.tsx",
      "page.tsx",
      "(app)/soon/page.tsx",
      "(app)/soon/[feature]/page.tsx",
    ]) {
      const code = source(file);
      expect(code, file).not.toMatch(/getSession|loadShellData/);
      expect(code, file).toMatch(/from "@\/components\/shell\/shell-session"/);
    }
  });
});

describe("viewer presentation takes precedence over simpleMode", () => {
  it("uses the chosen space's viewer shell without changing the stored personal preference", async () => {
    mocks.session = {
      ...jonas,
      simpleMode: true,
      memberships: [
        { spaceId: "s1", role: "owner" },
        { spaceId: "s2", role: "viewer" },
      ],
    };
    mocks.spaceCookie = "s2";
    mocks.spaceRole = "viewer";
    expect(await getShellSession()).toEqual({ ...mocks.session, simpleMode: false });
    expect(mocks.session.simpleMode).toBe(true);
    expect(mocks.loadCalls).toEqual([[mocks.session, "s2"]]);
  });

  it.each(["owner", "carer"] as const)(
    "preserves simpleMode in a chosen %s space",
    async (role) => {
      mocks.session = {
        ...jonas,
        simpleMode: true,
        memberships: [
          { spaceId: "s1", role: "viewer" },
          { spaceId: "s2", role },
        ],
      };
      mocks.spaceCookie = "s2";
      mocks.spaceRole = role;
      expect(await getShellSession()).toEqual(mocks.session);
    },
  );
});

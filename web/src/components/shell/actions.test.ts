import type { SessionContext } from "@frejsi/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: null as SessionContext | null,
  jar: new Map<string, { value: string; options: unknown }>(),
  redirected: [] as string[],
}));
vi.mock("@/lib/auth/session", () => ({ getSession: () => Promise.resolve(mocks.session) }));
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      set: (name: string, value: string, options: unknown) => {
        mocks.jar.set(name, { value, options });
      },
      get: (name: string) => mocks.jar.get(name),
    }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    mocks.redirected.push(to);
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));

import { switchSpace } from "./actions";
import { SPACE_COOKIE } from "./space-cookie";

const form = (entries: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(entries)) data.set(k, v);
  return data;
};

const jonas: SessionContext = {
  userId: "u1",
  name: "Jonas",
  simpleMode: false,
  accent: "olive",
  locale: "da",
  memberships: [
    { spaceId: "s1", role: "owner" },
    { spaceId: "s2", role: "viewer" },
  ],
};

afterEach(() => {
  mocks.session = null;
  mocks.jar.clear();
  mocks.redirected.length = 0;
});

describe("switchSpace (design gap 11)", () => {
  it("remembers a space the user belongs to on this device and goes to the locale's front page", async () => {
    mocks.session = jonas;
    await expect(switchSpace(form({ spaceId: "s2", locale: "en" }))).rejects.toThrow(
      "NEXT_REDIRECT /en",
    );
    const cookie = mocks.jar.get(SPACE_COOKIE);
    expect(SPACE_COOKIE).toBe("frejsi_space");
    expect(cookie?.value).toBe("s2");
    expect(cookie?.options).toMatchObject({ path: "/", sameSite: "lax", httpOnly: true });
    expect(mocks.redirected).toEqual(["/en"]);
  });

  it("ignores a space the user is not a member of, and anyone without a session", async () => {
    mocks.session = jonas;
    await expect(switchSpace(form({ spaceId: "s9", locale: "da" }))).rejects.toThrow(
      "NEXT_REDIRECT /da",
    );
    expect(mocks.jar.has(SPACE_COOKIE)).toBe(false);

    mocks.session = null;
    await expect(switchSpace(form({ spaceId: "s1", locale: "da" }))).rejects.toThrow(
      "NEXT_REDIRECT /da/welcome",
    );
    expect(mocks.jar.has(SPACE_COOKIE)).toBe(false);
  });

  it("falls back to da for a locale it does not know", async () => {
    mocks.session = jonas;
    await expect(switchSpace(form({ spaceId: "s1", locale: "xx" }))).rejects.toThrow(
      "NEXT_REDIRECT /da",
    );
  });
});

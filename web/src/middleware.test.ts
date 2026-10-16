// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SESSION_COOKIE as AUTH_SESSION_COOKIE } from "@/lib/auth/session";

import { SESSION_COOKIE, config, isProtectedPath, middleware } from "./middleware";

const request = (path: string, init: { cookie?: string; acceptLanguage?: string } = {}) => {
  const headers = new Headers();
  if (init.cookie) headers.set("cookie", init.cookie);
  if (init.acceptLanguage) headers.set("accept-language", init.acceptLanguage);
  return new NextRequest(new URL(path, "http://localhost:3000"), { headers });
};

const location = (res: Response) => new URL(res.headers.get("location") ?? "", "http://x").pathname;

describe("middleware", () => {
  it("looks for the same session cookie that the auth module sets", () => {
    // Duplicated on purpose: the auth module imports Prisma, which the edge cannot load.
    expect(SESSION_COOKIE).toBe(AUTH_SESSION_COOKIE);
    const res = middleware(request("/da/now", { cookie: `${AUTH_SESSION_COOKIE}=abc` }));
    expect(res.status).toBe(200);
  });

  it("routes / to da by default and to en when the browser prefers it", () => {
    const res = middleware(request("/"));
    expect(res.status).toBe(307);
    // Not signed in: straight to the welcome page in the resolved locale.
    expect(location(res)).toBe("/da/welcome");

    const en = middleware(request("/", { acceptLanguage: "en-GB,en;q=0.9" }));
    expect(location(en)).toBe("/en/welcome");
  });

  it("keeps the locale a signed-in user chose in the URL and tells the layout which it is", () => {
    const res = middleware(request("/en/now", { cookie: "frejsi_session=abc" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-request-x-frejsi-locale")).toBe("en");
    expect(res.cookies.get("frejsi_locale")?.value).toBe("en");
  });

  it("sends a signed-in visitor without a locale to the one they used last, else the browser's", () => {
    const remembered = middleware(
      request("/now", { cookie: "frejsi_session=abc; frejsi_locale=en" }),
    );
    expect(location(remembered)).toBe("/en/now");
    const fresh = middleware(request("/now?x=1", { cookie: "frejsi_session=abc" }));
    expect(fresh.headers.get("location")).toBe("http://localhost:3000/da/now?x=1");
  });

  it("redirects a request under (app) without a frejsi_session cookie to welcome, in its locale", () => {
    expect(location(middleware(request("/da/now")))).toBe("/da/welcome");
    expect(location(middleware(request("/en/settings")))).toBe("/en/welcome");
    expect(location(middleware(request("/da/soon/meals")))).toBe("/da/welcome");
    expect(location(middleware(request("/da")))).toBe("/da/welcome");
  });

  it("lets welcome and the invite page through without a cookie", () => {
    expect(middleware(request("/da/welcome")).status).toBe(200);
    expect(middleware(request("/en/invite/some-token")).status).toBe(200);
  });

  it("does not run on api routes, Next internals or files", () => {
    const matcher = config.matcher[0];
    expect(matcher).toBeDefined();
    const re = new RegExp(`^${matcher ?? ""}$`);
    expect(re.test("/da/now")).toBe(true);
    expect(re.test("/")).toBe(true);
    expect(re.test("/api/health")).toBe(false);
    expect(re.test("/_next/static/chunk.js")).toBe(false);
    expect(re.test("/manifest.webmanifest")).toBe(false);
    expect(re.test("/sw.js")).toBe(false);
    expect(re.test("/icons/icon-192.png")).toBe(false);
  });

  it("isProtectedPath knows the public pages", () => {
    expect(isProtectedPath("/now")).toBe(true);
    expect(isProtectedPath("/")).toBe(true);
    expect(isProtectedPath("/welcome")).toBe(false);
    expect(isProtectedPath("/invite/x")).toBe(false);
    expect(isProtectedPath("/welcomes")).toBe(true);
  });
});

describe("middleware with DEFAULT_LOCALE", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("lands a first visit with no cookie and no Accept-Language on /en", () => {
    vi.stubEnv("DEFAULT_LOCALE", "en");
    expect(location(middleware(request("/")))).toBe("/en/welcome");
    const signedIn = middleware(request("/now", { cookie: "frejsi_session=abc" }));
    expect(signedIn.headers.get("location")).toBe("http://localhost:3000/en/now");
    expect(signedIn.cookies.get("frejsi_locale")?.value).toBe("en");
  });

  it("still lets the visitor's own signals win: the cookie, then Accept-Language", () => {
    vi.stubEnv("DEFAULT_LOCALE", "en");
    expect(location(middleware(request("/", { cookie: "frejsi_locale=da" })))).toBe("/da/welcome");
    expect(location(middleware(request("/", { acceptLanguage: "da-DK,da;q=0.9" })))).toBe(
      "/da/welcome",
    );
  });

  it("falls back to da when the variable is unset or invalid", () => {
    for (const value of [undefined, "", "sv", "english"]) {
      vi.stubEnv("DEFAULT_LOCALE", value);
      expect(location(middleware(request("/"))), String(value)).toBe("/da/welcome");
    }
  });
});

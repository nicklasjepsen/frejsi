import { NextResponse, type NextRequest } from "next/server";

import {
  LOCALE_COOKIE,
  LOCALE_HEADER,
  localeHref,
  negotiateLocale,
  resolveLocale,
  stripLocale,
  type AppLocale,
} from "@/lib/i18n/routing";

/**
 * The session cookie name, duplicated from `@/lib/auth/session` on purpose: that module imports
 * Prisma, which cannot run on the edge. A test asserts the two stay equal. The value is checked
 * by `getSession()`, never here (plan §6).
 */
export const SESSION_COOKIE = "frejsi_session";

/** Pages a visitor reaches without a session: the invite landing and the returning sign-in. */
const PUBLIC_PAGES = ["/welcome", "/invite"];

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

/** Everything under the locale that is not a public page lives in the `(app)` group. */
export function isProtectedPath(path: string): boolean {
  return !PUBLIC_PAGES.some((page) => page === path || path.startsWith(`${page}/`));
}

/** The locale for a request without one in the URL: last used, then the browser's, then `da`. */
function preferredLocale(request: NextRequest): AppLocale {
  const remembered = request.cookies.get(LOCALE_COOKIE)?.value;
  if (remembered) return resolveLocale(remembered);
  return negotiateLocale(request.headers.get("accept-language")) ?? resolveLocale(null);
}

function rememberLocale(response: NextResponse, locale: AppLocale): NextResponse {
  response.cookies.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
    sameSite: "lax",
  });
  return response;
}

/**
 * Locale routing (`/` → `/da` by default, `/en` when remembered or preferred; a URL with a locale
 * keeps it) and a convenience redirect: a request under `(app)` without the session cookie goes
 * to `welcome`. The redirect is not security; the `(app)` layout calls `getSession()` and every
 * route calls `requireRole` (plan §6).
 */
export function middleware(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
  const stripped = stripLocale(pathname);
  const locale = stripped.locale ?? preferredLocale(request);
  const path = stripped.locale ? stripped.path : pathname;
  const signedIn = request.cookies.has(SESSION_COOKIE);

  if (!signedIn && isProtectedPath(path)) {
    const welcome = new URL(localeHref(locale, "/welcome"), request.url);
    return rememberLocale(NextResponse.redirect(welcome), locale);
  }

  if (!stripped.locale) {
    const target = new URL(localeHref(locale, path) + search, request.url);
    return rememberLocale(NextResponse.redirect(target), locale);
  }

  const headers = new Headers(request.headers);
  headers.set(LOCALE_HEADER, locale);
  return rememberLocale(NextResponse.next({ request: { headers } }), locale);
}

export const config = {
  // Pages only: not the API, Next internals, or files such as the manifest, icons and sw.js.
  matcher: ["/((?!api|_next|.*\\..*).*)"],
};

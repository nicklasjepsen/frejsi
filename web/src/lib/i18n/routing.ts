/**
 * The locales, duplicated from `Locale` in @frejsi/shared on purpose: this module is imported by
 * the middleware, which runs on the edge and must not pull in the Prisma client that the shared
 * index exports. A test asserts the two lists stay equal.
 */
export const LOCALES = ["da", "en"] as const;
export type AppLocale = (typeof LOCALES)[number];

/**
 * The documented fallback when `DEFAULT_LOCALE` is unset or not one of ours: the product is
 * Danish-first. A deployment changes the default with the `DEFAULT_LOCALE` repository variable
 * (infra/README.md), never by editing this.
 */
export const FALLBACK_LOCALE: AppLocale = "da";

/**
 * The locale for a visitor with no signal of their own, and for a new user: the deployment's
 * `DEFAULT_LOCALE` when it names one of ours, else the fallback. Read at call time from the server's
 * environment (the middleware's runtime included), so changing the setting needs no rebuild; client
 * code gets its locale from the provider instead, where `process.env` has no such variable.
 */
export function defaultLocale(
  env: Readonly<Record<string, string | undefined>> = process.env,
): AppLocale {
  const configured = env.DEFAULT_LOCALE?.trim();
  return isLocale(configured) ? configured : FALLBACK_LOCALE;
}

/** The cookie that remembers the locale a visitor last used, so `/` goes there next time. */
export const LOCALE_COOKIE = "frejsi_locale";
/** The request header the middleware sets so the root layout can put `lang` on `<html>`. */
export const LOCALE_HEADER = "x-frejsi-locale";

export function isLocale(value: unknown): value is AppLocale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** The locale, or the deployment's default for anything that is not one. */
export function resolveLocale(value: string | null | undefined): AppLocale {
  return isLocale(value) ? value : defaultLocale();
}

/**
 * The best locale for an `Accept-Language` header, by q-value and language prefix (`en-GB` →
 * `en`); null when none of ours is listed.
 */
export function negotiateLocale(acceptLanguage: string | null | undefined): AppLocale | null {
  if (!acceptLanguage) return null;
  const ranked = acceptLanguage
    .split(",")
    .map((part, index) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params
        .map((p) => p.trim())
        .find((p) => p.startsWith("q="))
        ?.slice(2);
      const weight = q === undefined ? 1 : Number(q);
      return { tag: tag.trim().toLowerCase(), weight: Number.isFinite(weight) ? weight : 0, index };
    })
    .filter((entry) => entry.tag !== "" && entry.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  for (const { tag } of ranked) {
    const language = tag.split("-")[0] ?? tag;
    if (isLocale(language)) return language;
  }
  return null;
}

/** `/now` → `/da/now`; `/` → `/da`. */
export function localeHref(locale: AppLocale, path: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  return clean === "/" ? `/${locale}` : `/${locale}${clean}`;
}

/** `/da/now` → `{ locale: "da", path: "/now" }`; a path without a locale prefix keeps itself. */
export function stripLocale(pathname: string): { locale: AppLocale | null; path: string } {
  const [, first = "", ...rest] = pathname.split("/");
  if (!isLocale(first)) return { locale: null, path: pathname };
  const path = `/${rest.join("/")}`;
  return { locale: first, path: path === "/" ? "/" : path.replace(/\/+$/, "") };
}

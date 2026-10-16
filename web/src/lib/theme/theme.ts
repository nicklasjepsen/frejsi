// The appearance setting on the device: the `frejsi_theme` cookie that mirrors `User.theme`, the
// `data-theme` attribute on <html> that tokens.css reads, and the colour of the browser chrome.
// Values come from the pure schema module by path, never from the shared index: this runs in the
// client bundle too, which must not pull in the Prisma client (plan §2; see routing.ts).
import { type Theme, themeOrDefault } from "@frejsi/shared/schemas/settings";

/**
 * Mirrors the stored preference so the root layout can set `data-theme` before the first paint.
 * No PII: one of three words. Not HttpOnly, because the Colour screen writes it for the preview.
 */
export const THEME_COOKIE = "frejsi_theme";
/** One year; the stored preference is the truth and the shell re-mirrors it on every visit. */
export const THEME_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

const COOKIE_ATTRIBUTES = "Path=/; SameSite=Lax";

/** The `Set-Cookie` value that mirrors `theme`; `system` clears the cookie, as nothing is forced. */
export function themeCookie(theme: Theme): string {
  if (theme === "system") return clearedThemeCookie();
  return `${THEME_COOKIE}=${theme}; ${COOKIE_ATTRIBUTES}; Max-Age=${THEME_COOKIE_MAX_AGE_SECONDS}`;
}

/** The `Set-Cookie` value that forgets the theme: sign-out, or back to `system`. */
export function clearedThemeCookie(): string {
  return `${THEME_COOKIE}=; ${COOKIE_ATTRIBUTES}; Max-Age=0`;
}

/** `data-theme` on <html>: `light` or `dark` when forced, nothing when the device decides. */
export function htmlThemeAttribute(theme: Theme): "light" | "dark" | undefined {
  return theme === "system" ? undefined : theme;
}

/** The theme a cookie value names; a missing or unknown cookie is `system`. */
export function themeFromCookie(value: string | null | undefined): Theme {
  return themeOrDefault(value);
}

/** The `theme-color` of the browser chrome and the PWA status bar (tokens.json ground). */
export const THEME_COLORS = { light: "#F6F1E8", dark: "#1F1B17" } as const;

/**
 * What the root layout's viewport declares: one colour when the theme is forced, else the pair
 * that follows the device.
 */
export function themeColorFor(theme: Theme): string | { media: string; color: string }[] {
  if (theme !== "system") return THEME_COLORS[theme];
  return [
    { media: "(prefers-color-scheme: light)", color: THEME_COLORS.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark },
  ];
}

/**
 * Applies `theme` to the open document at once: `data-theme` on <html> (tokens.css switches on
 * it) and the cookie, so the next page load paints the same. The stored preference is written by
 * the caller; this is the preview and the mirror.
 */
export function applyTheme(theme: Theme, doc: Document = document): void {
  const attribute = htmlThemeAttribute(theme);
  if (attribute === undefined) delete doc.documentElement.dataset.theme;
  else doc.documentElement.dataset.theme = attribute;
  doc.cookie = themeCookie(theme);
}

/** The theme the open document shows, read back from `data-theme`; the device's when unset. */
export function documentTheme(doc: Document = document): Theme {
  return themeOrDefault(doc.documentElement.dataset.theme);
}

import { describe, expect, it } from "vitest";

import {
  THEME_COOKIE,
  applyTheme,
  clearedThemeCookie,
  documentTheme,
  htmlThemeAttribute,
  themeColorFor,
  themeCookie,
  themeFromCookie,
} from "./theme";

describe("the theme cookie", () => {
  it("is frejsi_theme for a year, SameSite=Lax, on the whole site, and never HttpOnly", () => {
    expect(themeCookie("dark")).toBe("frejsi_theme=dark; Path=/; SameSite=Lax; Max-Age=31536000");
    expect(themeCookie("light")).toBe("frejsi_theme=light; Path=/; SameSite=Lax; Max-Age=31536000");
    expect(themeCookie("dark")).not.toContain("HttpOnly");
    expect(THEME_COOKIE).toBe("frejsi_theme");
  });

  it("is cleared for system, and on sign-out", () => {
    expect(themeCookie("system")).toBe("frejsi_theme=; Path=/; SameSite=Lax; Max-Age=0");
    expect(clearedThemeCookie()).toBe(themeCookie("system"));
  });

  it("reads back to the theme, with system for a missing or unknown value", () => {
    expect(themeFromCookie("dark")).toBe("dark");
    expect(themeFromCookie("light")).toBe("light");
    for (const value of ["auto", "", null, undefined])
      expect(themeFromCookie(value)).toBe("system");
  });
});

describe("data-theme on <html>", () => {
  it("is light or dark when forced and absent when the device decides", () => {
    expect(htmlThemeAttribute("light")).toBe("light");
    expect(htmlThemeAttribute("dark")).toBe("dark");
    expect(htmlThemeAttribute("system")).toBeUndefined();
  });

  it("applyTheme sets the attribute and the cookie at once, and system removes both", () => {
    applyTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.cookie).toContain("frejsi_theme=dark");
    expect(documentTheme()).toBe("dark");

    applyTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.cookie).toContain("frejsi_theme=light");

    applyTheme("system");
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(document.cookie).not.toContain("frejsi_theme");
    expect(documentTheme()).toBe("system");
  });
});

describe("theme-color", () => {
  it("follows the device as a media pair for system, and is one colour when forced", () => {
    expect(themeColorFor("system")).toEqual([
      { media: "(prefers-color-scheme: light)", color: "#F6F1E8" },
      { media: "(prefers-color-scheme: dark)", color: "#1F1B17" },
    ]);
    expect(themeColorFor("light")).toBe("#F6F1E8");
    expect(themeColorFor("dark")).toBe("#1F1B17");
  });
});

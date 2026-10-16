import { describe, expect, it } from "vitest";

import {
  Accent,
  Locale,
  SpaceSettings,
  Theme,
  UserSettings,
  localeOrDefault,
  themeOrDefault,
} from "./settings";

describe("localeOrDefault", () => {
  it("keeps a known locale and falls back to the column's default for anything else", () => {
    expect(localeOrDefault("en")).toBe("en");
    expect(localeOrDefault("da")).toBe("da");
    for (const unknown of ["de", "", null, undefined]) {
      expect(localeOrDefault(unknown)).toBe("da");
    }
  });
});

describe("Accent and Locale", () => {
  it("use English identifiers; the Danish names are UI strings", () => {
    expect(Accent.options).toEqual(["olive", "plum", "sea", "forest", "garnet"]);
    expect(Accent.safeParse("blomme").success).toBe(false);
    expect(Locale.options).toEqual(["da", "en"]);
    expect(Locale.safeParse("de").success).toBe(false);
  });
});

describe("Theme", () => {
  it("is system, light or dark, with system first as the column's default", () => {
    expect(Theme.options).toEqual(["system", "light", "dark"]);
    expect(Theme.safeParse("auto").success).toBe(false);
  });

  it("themeOrDefault keeps a known theme and falls back to system for anything else", () => {
    expect(themeOrDefault("dark")).toBe("dark");
    expect(themeOrDefault("light")).toBe("light");
    for (const unknown of ["auto", "", null, undefined]) {
      expect(themeOrDefault(unknown)).toBe("system");
    }
  });
});

describe("SpaceSettings", () => {
  const valid = {
    aiEnabled: false,
    name: "Example space",
    glucoseUnit: "mmol",
    targetLow: 4,
    targetHigh: 10,
    timezone: "Europe/Copenhagen",
    sourceType: "dexcom-share",
    sourceStatus: "connected",
    lastReadingAt: "2026-10-15T08:00:00.000Z",
  };

  it("accepts the settings an owner edits", () => {
    expect(SpaceSettings.parse(valid)).toEqual(valid);
    expect(
      SpaceSettings.safeParse({ ...valid, sourceType: null, lastReadingAt: null }).success,
    ).toBe(true);
  });

  it("accepts opt-in and a provider but rejects unknown read-model keys", () => {
    expect(SpaceSettings.parse({ ...valid, aiEnabled: true, aiProvider: "anthropic" })).toEqual({
      ...valid,
      aiEnabled: true,
      aiProvider: "anthropic",
    });
    expect(SpaceSettings.safeParse({ ...valid, secret: "hidden" }).success).toBe(false);
    expect(SpaceSettings.safeParse({ ...valid, aiProvider: "other" }).success).toBe(false);
    expect(Object.keys(SpaceSettings.shape).sort()).toEqual([
      "aiEnabled",
      "aiProvider",
      "glucoseUnit",
      "lastReadingAt",
      "name",
      "sourceStatus",
      "sourceType",
      "targetHigh",
      "targetLow",
      "timezone",
    ]);
  });

  it("rejects a target range that is not low < high", () => {
    expect(SpaceSettings.safeParse({ ...valid, targetLow: 10, targetHigh: 4 }).success).toBe(false);
  });
});

describe("UserSettings", () => {
  const valid = { locale: "en", simpleMode: true, accent: "sea", theme: "dark" };

  it("accepts locale, simpleMode, accent and theme", () => {
    expect(UserSettings.parse(valid)).toEqual(valid);
  });

  it("rejects an unknown accent or theme, and a missing theme", () => {
    expect(UserSettings.safeParse({ ...valid, accent: "red" }).success).toBe(false);
    expect(UserSettings.safeParse({ ...valid, theme: "auto" }).success).toBe(false);
    const { theme: _theme, ...withoutTheme } = valid;
    expect(UserSettings.safeParse(withoutTheme).success).toBe(false);
  });
});

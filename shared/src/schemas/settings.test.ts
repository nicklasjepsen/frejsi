import { describe, expect, it } from "vitest";

import { Accent, Locale, SpaceSettings, UserSettings } from "./settings";

describe("Accent and Locale", () => {
  it("use English identifiers; the Danish names are UI strings", () => {
    expect(Accent.options).toEqual(["olive", "plum", "sea", "forest", "garnet"]);
    expect(Accent.safeParse("blomme").success).toBe(false);
    expect(Locale.options).toEqual(["da", "en"]);
    expect(Locale.safeParse("de").success).toBe(false);
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
  it("accepts locale, simpleMode and accent", () => {
    expect(UserSettings.parse({ locale: "en", simpleMode: true, accent: "sea" })).toEqual({
      locale: "en",
      simpleMode: true,
      accent: "sea",
    });
  });

  it("rejects an unknown accent", () => {
    expect(UserSettings.safeParse({ locale: "en", simpleMode: true, accent: "red" }).success).toBe(
      false,
    );
  });
});

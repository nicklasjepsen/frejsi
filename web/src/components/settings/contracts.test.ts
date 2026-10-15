import { describe, expect, it } from "vitest";

import { ConnectSourceBody, SpaceSettingsPatch, UserSettingsPatch, definedOnly } from "./contracts";

describe("settings contracts", () => {
  it("SpaceSettingsPatch takes unit and target range in mmol with one decimal, and needs at least one field", () => {
    expect(SpaceSettingsPatch.parse({ glucoseUnit: "mgdl" })).toEqual({ glucoseUnit: "mgdl" });
    expect(SpaceSettingsPatch.parse({ targetLow: 3.9, targetHigh: 10 })).toEqual({
      targetLow: 3.9,
      targetHigh: 10,
    });
    expect(SpaceSettingsPatch.safeParse({}).success).toBe(false);
    expect(SpaceSettingsPatch.safeParse({ targetLow: 3.95 }).success).toBe(false);
    expect(SpaceSettingsPatch.safeParse({ targetLow: 12, targetHigh: 10 }).success).toBe(false);
    expect(SpaceSettingsPatch.safeParse({ glucoseUnit: "mmol/L" }).success).toBe(false);
    expect(SpaceSettingsPatch.safeParse({ name: "x" }).success).toBe(false);
  });

  it("UserSettingsPatch takes locale, simpleMode and accent, at least one", () => {
    expect(UserSettingsPatch.parse({ accent: "plum" })).toEqual({ accent: "plum" });
    expect(UserSettingsPatch.parse({ locale: "en", simpleMode: true })).toEqual({
      locale: "en",
      simpleMode: true,
    });
    expect(UserSettingsPatch.safeParse({}).success).toBe(false);
    expect(UserSettingsPatch.safeParse({ accent: "red" }).success).toBe(false);
    expect(UserSettingsPatch.safeParse({ name: "x" }).success).toBe(false);
  });

  it("ConnectSourceBody is the ConnectSourceRequest without the spaceId, which comes from the path", () => {
    expect(
      ConnectSourceBody.parse({
        type: "dexcom-share",
        region: "eu",
        username: "example-user",
        password: "example-pass",
      }),
    ).toEqual({ type: "dexcom-share", region: "eu", username: "example-user", password: "example-pass" });
    expect(ConnectSourceBody.safeParse({ type: "dexcom-share", region: "eu" }).success).toBe(false);
    expect(ConnectSourceBody.safeParse({ type: "nightscout", region: "eu", username: "a", password: "b" }).success).toBe(false);
  });

  it("definedOnly drops undefined keys so a partial patch is a Prisma data object", () => {
    expect(definedOnly({ a: 1, b: undefined, c: "x" })).toEqual({ a: 1, c: "x" });
  });
});

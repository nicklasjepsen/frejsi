import { describe, expect, it } from "vitest";

import {
  LiveRegisterCreated,
  LiveRegisterError,
  LiveRegisterRequest,
  LiveRegisterUpdated,
  LiveThresholds,
} from "./live";

const token = "a1".repeat(32);

const body = {
  nightscoutUrl: "https://ns.example.org",
  nightscoutToken: "fixture-token",
  pushToStartToken: token,
  activityPushToken: null,
  activityStartedAt: null,
  deviceToken: token.toUpperCase(),
  apnsEnvironment: "sandbox",
  unit: "mmolL",
  thresholds: { urgentLowMgdl: 55, lowMgdl: 80, highMgdl: 180, urgentHighMgdl: 260 },
  alertsOn: true,
  language: "da",
};

describe("LiveRegisterRequest", () => {
  it("parses the contract's create body and lower-cases the tokens", () => {
    const parsed = LiveRegisterRequest.parse(body);
    expect(parsed.deviceToken).toBe(token);
    expect(parsed.activityPushToken).toBeNull();
    expect(parsed.subscriptionId).toBeUndefined();
  });

  it("takes the literal demo and an ISO time with an offset", () => {
    const parsed = LiveRegisterRequest.parse({
      ...body,
      nightscoutUrl: "demo",
      nightscoutToken: undefined,
      activityStartedAt: "2026-11-08T10:00:00+01:00",
      subscriptionId: "0b5c1f7e-3a1d-4c55-9e0a-2f7a7d0e9b11",
    });
    expect(parsed.nightscoutUrl).toBe("demo");
  });

  it("refuses http, a query, a bad token and thresholds out of order", () => {
    for (const change of [
      { nightscoutUrl: "http://ns.example.org" },
      { nightscoutUrl: "https://ns.example.org/?token=x" },
      { pushToStartToken: "not-hex" },
      { thresholds: { urgentLowMgdl: 55, lowMgdl: 200, highMgdl: 180, urgentHighMgdl: 260 } },
      { unit: "mmol" },
      { language: "de" },
      { subscriptionId: "../etc" },
    ]) {
      expect(
        LiveRegisterRequest.safeParse({ ...body, ...change }).success,
        JSON.stringify(change),
      ).toBe(false);
    }
  });

  it("has the Nightscout defaults as valid thresholds", () => {
    expect(LiveThresholds.safeParse(body.thresholds).success).toBe(true);
  });
});

describe("the responses", () => {
  it("are the contract's shapes", () => {
    const id = "0b5c1f7e-3a1d-4c55-9e0a-2f7a7d0e9b11";
    expect(
      LiveRegisterCreated.parse({ subscriptionId: id, deviceSecret: "x".repeat(43) }),
    ).toBeTruthy();
    expect(LiveRegisterUpdated.parse({ subscriptionId: id })).toEqual({ subscriptionId: id });
    expect(LiveRegisterError.parse({ error: "nightscout-refused" })).toBeTruthy();
    expect(LiveRegisterError.safeParse({ error: "other" }).success).toBe(false);
  });
});

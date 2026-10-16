import { describe, expect, it } from "vitest";

import {
  ConnectSourceRequest,
  ConnectSourceResult,
  GlucoseSourceConfig,
  GlucoseSourceType,
  GlucoseUnit,
  ManualReadingRequest,
  NightscoutCredential,
  Reading,
  SourceStatus,
  Trend,
} from "./glucose";

describe("Reading", () => {
  const valid = { ts: "2026-10-15T08:00:00.000Z", mmol: 6.2, trend: "flat" };

  it("accepts a reading with ts, mmol and trend", () => {
    expect(Reading.parse(valid)).toEqual(valid);
  });

  it("rejects a reading without ts: a value never travels without its time", () => {
    const { ts: _ts, ...withoutTs } = valid;
    expect(Reading.safeParse(withoutTs).success).toBe(false);
  });

  it("rejects a value outside 0-40 or with more than one decimal", () => {
    expect(Reading.safeParse({ ...valid, mmol: 41 }).success).toBe(false);
    expect(Reading.safeParse({ ...valid, mmol: -0.1 }).success).toBe(false);
    expect(Reading.safeParse({ ...valid, mmol: 6.25 }).success).toBe(false);
    expect(Reading.safeParse({ ...valid, mmol: 0.7 }).success).toBe(true);
  });

  it("rejects an unknown trend and a non-ISO timestamp", () => {
    expect(Reading.safeParse({ ...valid, trend: "up" }).success).toBe(false);
    expect(Reading.safeParse({ ...valid, ts: "yesterday" }).success).toBe(false);
  });

  it("knows exactly Dexcom's nine trends", () => {
    expect(Trend.options).toEqual([
      "double-up",
      "single-up",
      "forty-five-up",
      "flat",
      "forty-five-down",
      "single-down",
      "double-down",
      "not-computable",
      "rate-out-of-range",
    ]);
  });
});

describe("GlucoseSourceConfig", () => {
  it("accepts a dexcom-share config", () => {
    expect(
      GlucoseSourceConfig.safeParse({ type: "dexcom-share", region: "eu", secretRef: "glucose-s1" })
        .success,
    ).toBe(true);
  });

  it("narrows the three variants and rejects shapes that belong to another", () => {
    expect(
      GlucoseSourceConfig.safeParse({ type: "nightscout", secretRef: "glucose-s1" }).success,
    ).toBe(true);
    expect(GlucoseSourceConfig.safeParse({ type: "manual" }).success).toBe(true);
    expect(GlucoseSourceConfig.safeParse({ type: "nightscout" }).success).toBe(false);
    expect(GlucoseSourceConfig.safeParse({ type: "manual", secretRef: "x" }).success).toBe(false);
    expect(
      GlucoseSourceConfig.safeParse({ type: "nightscout", region: "eu", secretRef: "x" }).success,
    ).toBe(false);
    expect(GlucoseSourceConfig.safeParse({ type: "libre", secretRef: "x" }).success).toBe(false);
  });

  it("rejects an unknown region", () => {
    expect(
      GlucoseSourceConfig.safeParse({ type: "dexcom-share", region: "dk", secretRef: "x" }).success,
    ).toBe(false);
  });
});

describe("SourceStatus and GlucoseUnit", () => {
  it("accept their values and reject others", () => {
    expect(SourceStatus.safeParse("connected").success).toBe(true);
    expect(SourceStatus.safeParse("online").success).toBe(false);
    expect(GlucoseUnit.safeParse("mgdl").success).toBe(true);
    expect(GlucoseUnit.safeParse("mg/dL").success).toBe(false);
  });
});

describe("ConnectSourceRequest and ConnectSourceResult", () => {
  it("accept the contract between the Settings route and source-connect", () => {
    expect(
      ConnectSourceRequest.safeParse({
        spaceId: "s1",
        type: "dexcom-share",
        region: "eu",
        username: "publisher",
        password: "pw",
      }).success,
    ).toBe(true);
    expect(ConnectSourceResult.safeParse({ result: "ok", secretRef: "glucose-s1" }).success).toBe(
      true,
    );
    expect(ConnectSourceResult.safeParse({ result: "bad-credentials" }).success).toBe(true);
    expect(ConnectSourceResult.safeParse({ result: "unreachable" }).success).toBe(true);
  });

  it("reject a request without a password and a result with an unknown outcome", () => {
    expect(
      ConnectSourceRequest.safeParse({
        spaceId: "s1",
        type: "dexcom-share",
        region: "eu",
        username: "publisher",
      }).success,
    ).toBe(false);
    expect(ConnectSourceResult.safeParse({ result: "maybe" }).success).toBe(false);
    expect(ConnectSourceResult.safeParse({ result: "ok" }).success).toBe(false);
  });
});

describe("GlucoseSourceType", () => {
  it("accepts nightscout and manual", () => {
    expect(GlucoseSourceType.options).toEqual(["dexcom-share", "nightscout", "manual"]);
  });
});

describe("NightscoutCredential", () => {
  const url = "https://example-ns.example.invalid";
  it("accepts an https URL with exactly one of token and apiSecret", () => {
    expect(NightscoutCredential.safeParse({ url, token: "t-123" }).success).toBe(true);
    expect(NightscoutCredential.safeParse({ url, apiSecret: "twelve-chars" }).success).toBe(true);
    expect(NightscoutCredential.safeParse({ url: `${url}/base/`, token: "t" }).success).toBe(true);
  });

  it("rejects http, a query, a fragment, userinfo, both secrets and neither", () => {
    const bad = [
      { url: "http://example-ns.example.invalid", token: "t" },
      { url: `${url}/?token=abc`, token: "t" },
      { url: `${url}/#x`, token: "t" },
      { url: "https://user:pw@example-ns.example.invalid", token: "t" },
      { url: "https://user@example-ns.example.invalid", token: "t" },
      { url, token: "t", apiSecret: "s" },
      { url },
      { url, token: "" },
      { url: "not a url", token: "t" },
    ];
    for (const candidate of bad) {
      expect(NightscoutCredential.safeParse(candidate).success, JSON.stringify(candidate)).toBe(
        false,
      );
    }
  });
});

describe("ConnectSourceRequest union", () => {
  it("accepts the nightscout and manual variants", () => {
    expect(
      ConnectSourceRequest.safeParse({
        type: "nightscout",
        spaceId: "s1",
        url: "https://example-ns.example.invalid",
        token: "t",
      }).success,
    ).toBe(true);
    expect(ConnectSourceRequest.safeParse({ type: "manual", spaceId: "s1" }).success).toBe(true);
  });

  it("rejects nightscout with http, with both secrets, with neither, and a region on it", () => {
    const base = { type: "nightscout", spaceId: "s1", url: "https://example-ns.example.invalid" };
    expect(
      ConnectSourceRequest.safeParse({ ...base, url: "http://x.example.invalid", token: "t" })
        .success,
    ).toBe(false);
    expect(ConnectSourceRequest.safeParse({ ...base, token: "t", apiSecret: "s" }).success).toBe(
      false,
    );
    expect(ConnectSourceRequest.safeParse(base).success).toBe(false);
  });
});

describe("ManualReadingRequest", () => {
  it("defaults ts to now and requires a unit", () => {
    const parsed = ManualReadingRequest.parse({ value: 6.2, unit: "mmol" });
    expect(Math.abs(Date.parse(parsed.ts) - Date.now())).toBeLessThan(5000);
    expect(ManualReadingRequest.safeParse({ value: 6.2 }).success).toBe(false);
    expect(ManualReadingRequest.safeParse({ value: 6.2, unit: "mg/dL" }).success).toBe(false);
  });

  it("keeps a given ts", () => {
    const ts = "2026-10-15T10:00:00.000Z";
    expect(ManualReadingRequest.parse({ ts, value: 110, unit: "mgdl" }).ts).toBe(ts);
  });
});

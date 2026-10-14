import { describe, expect, it } from "vitest";

import {
  ConnectSourceRequest,
  ConnectSourceResult,
  GlucoseSourceConfig,
  GlucoseUnit,
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

  it("rejects an unknown type and an unknown region", () => {
    expect(
      GlucoseSourceConfig.safeParse({ type: "nightscout", region: "eu", secretRef: "x" }).success,
    ).toBe(false);
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

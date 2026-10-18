import { describe, expect, expectTypeOf, it } from "vitest";

import type { PumpSource } from "../pump/types";
import { pumpMealItemName } from "../pump/messages/index";
import { glucoseSecretName, pumpSecretName } from "../secrets/types";

import { ConnectSourceRequest, NightscoutUrl } from "./glucose";
import * as publicSchemas from "./index";
import {
  ConnectPumpBody,
  ConnectPumpRequest,
  ConnectPumpResult,
  PumpBolus,
  PumpBolusKind,
  PumpBolusView,
  PumpHistoryView,
  PumpRangeQuery,
  PumpSettingsView,
  PumpSourceConfig,
  SourceConnectBody,
} from "./pump";

const ts = "2026-10-18T11:58:00.000Z";
const url = "https://example-ns.example.invalid";

describe("PumpBolus (adapter output, v0.7.0 plan §4)", () => {
  const valid = { sourceId: "evt-1", ts, units: 2.4, kind: "standard" };

  it("accepts a bolus with its time, units, kind and optional calculator carbs", () => {
    expect(PumpBolus.parse(valid)).toEqual(valid);
    expect(PumpBolus.parse({ ...valid, carbs: 45 }).carbs).toBe(45);
    expect(PumpBolus.parse({ ...valid, units: 0 }).units).toBe(0);
    expect(PumpBolus.parse({ ...valid, units: 50 }).units).toBe(50);
    expect(PumpBolusKind.options).toEqual(["standard", "extended", "automatic", "other"]);
  });

  it("rejects units above 50, three decimals, a negative value and a missing sourceId", () => {
    expect(PumpBolus.safeParse({ ...valid, units: 50.01 }).success).toBe(false);
    expect(PumpBolus.safeParse({ ...valid, units: 1.125 }).success).toBe(false);
    expect(PumpBolus.safeParse({ ...valid, units: -0.1 }).success).toBe(false);
    const { sourceId: _sourceId, ...withoutSourceId } = valid;
    expect(PumpBolus.safeParse(withoutSourceId).success).toBe(false);
    expect(PumpBolus.safeParse({ ...valid, sourceId: "" }).success).toBe(false);
    expect(PumpBolus.safeParse({ ...valid, sourceId: "x".repeat(101) }).success).toBe(false);
  });

  it("rejects a bolus without its time, an unknown kind, zero carbs and anything extra", () => {
    const { ts: _ts, ...withoutTs } = valid;
    expect(PumpBolus.safeParse(withoutTs).success).toBe(false);
    expect(PumpBolus.safeParse({ ...valid, kind: "correction" }).success).toBe(false);
    expect(PumpBolus.safeParse({ ...valid, carbs: 0 }).success).toBe(false);
    expect(PumpBolus.safeParse({ ...valid, carbs: 1001 }).success).toBe(false);
    expect(PumpBolus.safeParse({ ...valid, glucose: 6.2 }).success).toBe(false);
    expect(PumpBolus.safeParse({ ...valid, enteredBy: "x" }).success).toBe(false);
  });
});

describe("PumpSourceConfig (stored on Space.pumpSource)", () => {
  it("is strict: the type, the secret reference and who connected it, nothing else", () => {
    const config = { type: "nightscout", secretRef: "pump-s1/abc123", connectedBy: "u1" };
    expect(PumpSourceConfig.parse(config)).toEqual(config);
    expect(PumpSourceConfig.safeParse({ ...config, url }).success).toBe(false);
    expect(PumpSourceConfig.safeParse({ ...config, token: "t" }).success).toBe(false);
    expect(PumpSourceConfig.safeParse({ ...config, apiSecret: "s" }).success).toBe(false);
    expect(
      PumpSourceConfig.safeParse({ type: "dexcom-share", secretRef: "x", connectedBy: "u1" })
        .success,
    ).toBe(false);
    expect(PumpSourceConfig.safeParse({ type: "nightscout", secretRef: "x" }).success).toBe(false);
  });
});

describe("ConnectPumpRequest and the source-connect body parser", () => {
  const pump = { purpose: "pump", type: "nightscout", spaceId: "s1", url, token: "t-1" };

  it("accepts a pump request with exactly one of token and apiSecret", () => {
    expect(ConnectPumpRequest.parse(pump)).toEqual(pump);
    const { token: _token, ...withSecret } = { ...pump, apiSecret: "twelve-chars" };
    expect(ConnectPumpRequest.safeParse(withSecret).success).toBe(true);
    expect(NightscoutUrl.safeParse(url).success).toBe(true);
  });

  it("rejects http://, a query string, both secrets, neither, another type and an extra key", () => {
    expect(
      ConnectPumpRequest.safeParse({ ...pump, url: "http://example-ns.example.invalid" }).success,
    ).toBe(false);
    expect(ConnectPumpRequest.safeParse({ ...pump, url: `${url}/?token=abc` }).success).toBe(false);
    expect(ConnectPumpRequest.safeParse({ ...pump, apiSecret: "s" }).success).toBe(false);
    const { token: _token, ...neither } = pump;
    expect(ConnectPumpRequest.safeParse(neither).success).toBe(false);
    expect(ConnectPumpRequest.safeParse({ ...pump, type: "dexcom-share" }).success).toBe(false);
    expect(ConnectPumpRequest.safeParse({ ...pump, region: "eu" }).success).toBe(false);
    expect(ConnectPumpRequest.safeParse({ ...pump, purpose: "glucose" }).success).toBe(false);
  });

  it("never reads a body with purpose pump as a glucose ConnectSourceRequest", () => {
    const parsed = SourceConnectBody.parse(pump);
    expect(parsed).toEqual({ purpose: "pump", request: pump });
    // The same body with the pump marker removed is a glucose connect for the Nightscout source.
    const { purpose: _purpose, ...glucose } = pump;
    expect(SourceConnectBody.parse(glucose)).toEqual({
      purpose: "glucose",
      request: ConnectSourceRequest.parse(glucose),
    });
    // A pump body that fails its own schema is a failure, not a glucose connect: neither the
    // strict Nightscout variant nor the lenient Dexcom one may swallow it.
    for (const bad of [
      { ...pump, url: "http://example-ns.example.invalid" },
      { ...pump, url: `${url}/?token=abc` },
      { ...pump, apiSecret: "s" },
      { ...pump, type: "dexcom-share", region: "eu", username: "u", password: "p" },
      { purpose: "pump", type: "manual", spaceId: "s1" },
      { purpose: "glucose", type: "manual", spaceId: "s1" },
    ]) {
      const result = SourceConnectBody.safeParse(bad);
      expect(result.success, JSON.stringify(bad)).toBe(false);
    }
    // Every glucose variant still parses, as before.
    expect(SourceConnectBody.parse({ type: "manual", spaceId: "s1" })).toEqual({
      purpose: "glucose",
      request: { type: "manual", spaceId: "s1" },
    });
    expect(
      SourceConnectBody.parse({
        type: "dexcom-share",
        spaceId: "s1",
        region: "eu",
        username: "publisher",
        password: "pw",
      }).purpose,
    ).toBe("glucose");
  });

  it("ConnectPumpBody is what the Settings form posts: no spaceId, no purpose", () => {
    expect(ConnectPumpBody.parse({ type: "nightscout", url, token: "t" })).toEqual({
      type: "nightscout",
      url,
      token: "t",
    });
    expect(
      ConnectPumpBody.safeParse({ type: "nightscout", url, token: "t", spaceId: "s1" }).success,
    ).toBe(false);
    expect(
      ConnectPumpBody.safeParse({ type: "nightscout", url, token: "t", apiSecret: "s" }).success,
    ).toBe(false);
  });

  it("ConnectPumpResult answers ok with the reference and a count, or a refusal", () => {
    expect(
      ConnectPumpResult.parse({ result: "ok", secretRef: "pump-s1/v1", recentBoluses: 3 }),
    ).toEqual({
      result: "ok",
      secretRef: "pump-s1/v1",
      recentBoluses: 3,
    });
    expect(ConnectPumpResult.safeParse({ result: "ok", secretRef: "pump-s1/v1" }).success).toBe(
      true,
    );
    expect(ConnectPumpResult.safeParse({ result: "bad-credentials" }).success).toBe(true);
    expect(ConnectPumpResult.safeParse({ result: "unreachable" }).success).toBe(true);
    expect(ConnectPumpResult.safeParse({ result: "ok" }).success).toBe(false);
    expect(ConnectPumpResult.safeParse({ result: "maybe" }).success).toBe(false);
  });
});

describe("the pump views (owners and carers outside simpleMode only)", () => {
  const bolus = { id: "b1", ts, units: 2.4, kind: "standard" };

  it("PumpBolusView carries the time with the units, the kind, the carbs and the meal it belongs to", () => {
    expect(PumpBolusView.parse(bolus)).toEqual(bolus);
    expect(PumpBolusView.parse({ ...bolus, carbs: 45, mealId: "m1" }).mealId).toBe("m1");
    const { ts: _ts, ...withoutTs } = bolus;
    expect(PumpBolusView.safeParse(withoutTs).success).toBe(false);
    expect(PumpBolusView.safeParse({ ...bolus, sourceId: "evt-1" }).success).toBe(false);
  });

  it("PumpHistoryView carries the boluses, the reach and the status", () => {
    const view = { boluses: [bolus], reach: ts, status: "connected" };
    expect(PumpHistoryView.parse(view)).toEqual(view);
    expect(PumpHistoryView.parse({ boluses: [], status: "not-configured" }).reach).toBeUndefined();
    expect(PumpHistoryView.safeParse({ boluses: [bolus], status: "online" }).success).toBe(false);
    expect(PumpHistoryView.safeParse({ ...view, readings: [] }).success).toBe(false);
  });

  it("PumpRangeQuery allows at most eight days, from before to", () => {
    const from = "2026-10-10T00:00:00.000Z";
    expect(PumpRangeQuery.parse({ from, to: "2026-10-18T00:00:00.000Z" })).toEqual({
      from,
      to: "2026-10-18T00:00:00.000Z",
    });
    expect(PumpRangeQuery.safeParse({ from, to: "2026-10-18T00:00:01.000Z" }).success).toBe(false);
    expect(PumpRangeQuery.safeParse({ from: "2026-10-18T00:00:00.000Z", to: from }).success).toBe(
      false,
    );
    expect(PumpRangeQuery.safeParse({ from }).success).toBe(false);
  });

  it("PumpSettingsView carries the status, since, the newest record and whether it is configured", () => {
    const view = { status: "connected", since: ts, lastPumpAt: ts, configured: true };
    expect(PumpSettingsView.parse(view)).toEqual(view);
    expect(PumpSettingsView.parse({ status: "not-configured", configured: false })).toEqual({
      status: "not-configured",
      configured: false,
    });
    expect(PumpSettingsView.safeParse({ status: "connected", configured: true, url }).success).toBe(
      false,
    );
  });
});

it("exports every pump schema from the public index", () => {
  for (const name of [
    "PumpBolusKind",
    "PumpBolus",
    "PumpSourceConfig",
    "ConnectPumpRequest",
    "ConnectPumpResult",
    "ConnectPumpBody",
    "SourceConnectBody",
    "PumpBolusView",
    "PumpHistoryView",
    "PumpRangeQuery",
    "PumpSettingsView",
  ])
    expect(publicSchemas, name).toHaveProperty(name);
});

describe("the pump record's other contracts", () => {
  it("names the Key Vault secret pump-<spaceId>, beside glucose-<spaceId>", () => {
    expect(pumpSecretName("s1")).toBe("pump-s1");
    expect(pumpSecretName("s1")).not.toBe(glucoseSecretName("s1"));
  });

  it("PumpSource reads boluses since a time and probes, nothing else", () => {
    expectTypeOf<keyof PumpSource>().toEqualTypeOf<"fetchBolusesSince" | "probe">();
    expectTypeOf<PumpSource["fetchBolusesSince"]>().returns.resolves.toEqualTypeOf<PumpBolus[]>();
    expectTypeOf<PumpSource["probe"]>().returns.resolves.toEqualTypeOf<
      "ok" | "bad-credentials" | "unreachable"
    >();
  });

  it("names the pump meal's item in both locales", () => {
    expect(pumpMealItemName("da")).toBe("Kulhydrater fra pumpen");
    expect(pumpMealItemName("en")).toBe("Carbs from the pump");
  });
});

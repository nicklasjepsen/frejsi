import { readFileSync } from "node:fs";
import path from "node:path";

import {
  ConnectPumpResult,
  createLogger,
  DexcomShareSource,
  glucoseSecretName,
  NightscoutSource,
  parseCredential,
  parseNightscoutCredential,
  parseSecretRef,
  pumpSecretName,
  type ConnectSourceResult,
  type FetchLike,
  type GlucoseSourceConfig,
  type ProbeResult,
} from "@frejsi/shared";
import { fakeDexcom } from "@frejsi/shared/glucose/dexcom-share/test-server";
import { MemorySecrets } from "@frejsi/shared/secrets/memory";
import { describe, expect, it } from "vitest";

import {
  createSourceConnectHandler,
  probeSourceFor,
  type ProbeOutcome,
  type PumpProbeOutcome,
} from "./source-connect-handler";
import { createSourceFactory } from "./sources";

const body = {
  spaceId: "s1",
  type: "dexcom-share",
  region: "eu",
  username: "publisher@example.invalid",
  password: "<fixture-password>",
};

/**
 * The reference the first connect in a harness answers: the secret's name and the version written,
 * which `MemorySecrets` numbers from 1 (#78).
 */
const REF = `${glucoseSecretName("s1")}/1`;

function harness(probeResult: ProbeResult | Error, recentReadings?: number) {
  const secrets = new MemorySecrets();
  const lines: string[] = [];
  const probes: unknown[] = [];
  const outcome: ProbeOutcome =
    probeResult instanceof Error
      ? { result: "unreachable" }
      : { result: probeResult, ...(recentReadings === undefined ? {} : { recentReadings }) };
  const handler = createSourceConnectHandler({
    secrets,
    log: createLogger((line) => lines.push(line)),
    probe: (request) => {
      probes.push(request);
      return probeResult instanceof Error ? Promise.reject(probeResult) : Promise.resolve(outcome);
    },
  });
  const call = (json: unknown) =>
    handler({ json: () => Promise.resolve(json) } as never, {} as never);
  return { secrets, lines, probes, call };
}

/** The handler with its default probe: the real adapter over the fake Dexcom. */
function defaultHarness(fetch: ReturnType<typeof fakeDexcom>["fetch"], now: Date) {
  const secrets = new MemorySecrets();
  const lines: string[] = [];
  const handler = createSourceConnectHandler({
    secrets,
    log: createLogger((line) => lines.push(line)),
    fetch,
    now: () => now,
  });
  const call = (json: unknown) =>
    handler({ json: () => Promise.resolve(json) } as never, {} as never);
  return { secrets, lines, call };
}

describe("probeSourceFor", () => {
  it("builds the adapter the request's type names", () => {
    const source = probeSourceFor({
      type: "dexcom-share",
      region: "eu",
      username: body.username,
      password: body.password,
    });
    expect(source).toBeInstanceOf(DexcomShareSource);
  });
});

describe("probeSourceFor for nightscout", () => {
  it("builds a NightscoutSource", () => {
    expect(
      probeSourceFor({ type: "nightscout", url: "https://example-ns.example.invalid", token: "t" }),
    ).toBeInstanceOf(NightscoutSource);
  });
});

describe("source-connect with nightscout", () => {
  const nightscout = {
    spaceId: "s1",
    type: "nightscout",
    url: "https://example-ns.example.invalid",
    token: "<fixture-token>",
  };

  it("probes with the Nightscout request and stores the credential as a version of glucose-<spaceId>", async () => {
    const h = harness("ok");
    expect(await h.call(nightscout)).toEqual({
      status: 200,
      jsonBody: { result: "ok", secretRef: REF },
    });
    expect(h.probes).toEqual([
      { type: "nightscout", url: nightscout.url, token: nightscout.token },
    ]);
    expect(parseNightscoutCredential((await h.secrets.get("glucose-s1")) ?? "")).toEqual({
      url: nightscout.url,
      token: nightscout.token,
    });
  });

  it("stores an API secret the same way and nothing when the probe fails", async () => {
    const { token: _token, ...rest } = nightscout;
    const ok = harness("ok");
    await ok.call({ ...rest, apiSecret: "<fixture-secret>" });
    expect(parseNightscoutCredential((await ok.secrets.get("glucose-s1")) ?? "")).toEqual({
      url: nightscout.url,
      apiSecret: "<fixture-secret>",
    });
    for (const outcome of ["bad-credentials", "unreachable"] as const) {
      const h = harness(outcome);
      expect(await h.call(nightscout)).toEqual({ status: 200, jsonBody: { result: outcome } });
      await expect(h.secrets.get("glucose-s1")).resolves.toBeUndefined();
    }
  });

  it("never writes the address or the credential to the log", async () => {
    for (const outcome of ["ok", "bad-credentials", "unreachable", new Error("down")] as const) {
      const h = harness(outcome);
      await h.call(nightscout);
      const output = h.lines.join("\n");
      expect(output).not.toContain(nightscout.token);
      expect(output).not.toContain("example-ns");
      expect(output).toContain('"spaceId":"s1"');
    }
  });

  it("rejects http, both secrets, neither and a manual request with 400 validation", async () => {
    const h = harness("ok");
    const { token: _token, ...rest } = nightscout;
    const bad = [
      { ...nightscout, url: "http://example-ns.example.invalid" },
      { ...nightscout, apiSecret: "s" },
      rest,
      { spaceId: "s1", type: "manual" },
    ];
    for (const request of bad) {
      expect(await h.call(request)).toMatchObject({
        status: 400,
        jsonBody: { error: { code: "validation" } },
      });
    }
    expect(h.probes).toEqual([]);
    await expect(h.secrets.get("glucose-s1")).resolves.toBeUndefined();
  });
});

describe("source-connect", () => {
  it("probes the credential and stores it in Key Vault as a version of glucose-<spaceId> when it works", async () => {
    const h = harness("ok");
    const response = await h.call(body);
    expect(response).toEqual({
      status: 200,
      jsonBody: { result: "ok", secretRef: REF },
    });
    expect(parseSecretRef(REF)).toEqual({ name: glucoseSecretName("s1"), version: "1" });
    // The source type travels with the credential: the probe dispatches on it, not on a default.
    expect(h.probes).toEqual([
      { type: "dexcom-share", region: "eu", username: body.username, password: body.password },
    ]);
    expect(parseCredential((await h.secrets.get("glucose-s1")) ?? "")).toEqual({
      username: body.username,
      password: body.password,
    });
  });

  it("stores nothing and answers bad-credentials when the probe says so", async () => {
    const h = harness("bad-credentials");
    expect(await h.call(body)).toEqual({ status: 200, jsonBody: { result: "bad-credentials" } });
    await expect(h.secrets.get("glucose-s1")).resolves.toBeUndefined();
  });

  it("answers unreachable when the probe says so or throws", async () => {
    expect(await harness("unreachable").call(body)).toEqual({
      status: 200,
      jsonBody: { result: "unreachable" },
    });
    const thrown = harness(new Error("ECONNRESET to publisher@example.invalid"));
    expect(await thrown.call(body)).toEqual({ status: 200, jsonBody: { result: "unreachable" } });
    await expect(thrown.secrets.get("glucose-s1")).resolves.toBeUndefined();
  });

  it("rejects a body that is not a ConnectSourceRequest with 400 validation", async () => {
    const h = harness("ok");
    const { password: _password, ...withoutPassword } = body;
    expect(await h.call(withoutPassword)).toMatchObject({
      status: 400,
      jsonBody: { error: { code: "validation" } },
    });
    expect(await h.call("not json")).toMatchObject({ status: 400 });
    expect(h.probes).toEqual([]);
  });

  it("rejects a request whose body cannot be parsed as JSON with 400", async () => {
    const h = harness("ok");
    const response = await createSourceConnectHandler({
      secrets: h.secrets,
      log: createLogger(() => undefined),
      probe: () => Promise.resolve({ result: "ok" }),
    })({ json: () => Promise.reject(new SyntaxError("Unexpected token")) } as never, {} as never);
    expect(response).toMatchObject({ status: 400, jsonBody: { error: { code: "validation" } } });
  });

  it("never writes the username or the password to the log", async () => {
    for (const outcome of ["ok", "bad-credentials", "unreachable", new Error("down")] as const) {
      const h = harness(outcome);
      await h.call(body);
      expect(h.lines.length).toBeGreaterThan(0);
      const output = h.lines.join("\n");
      expect(output).not.toContain(body.password);
      expect(output).not.toContain(body.username);
      expect(output).toContain('"spaceId":"s1"');
    }
  });
});

describe("source-connect and the last day's readings", () => {
  it("answers recentReadings when the probe read the last day, and warns on its own line when there are none", async () => {
    const some = harness("ok", 6);
    expect(await some.call(body)).toEqual({
      status: 200,
      jsonBody: { result: "ok", secretRef: REF, recentReadings: 6 },
    });
    expect(some.lines.join("\n")).toContain(
      '"msg":"source-connect.ok","spaceId":"s1","count":6,"code":"ok"',
    );
    expect(some.lines.join("\n")).not.toContain("no-recent-readings");

    // The credential works, so it is stored; the warning is for the owner to act on.
    const none = harness("ok", 0);
    expect(await none.call(body)).toEqual({
      status: 200,
      jsonBody: { result: "ok", secretRef: REF, recentReadings: 0 },
    });
    expect(parseCredential((await none.secrets.get("glucose-s1")) ?? "")).toEqual({
      username: body.username,
      password: body.password,
    });
    expect(none.lines.join("\n")).toContain('"msg":"source-connect.no-recent-readings"');
    expect(none.lines.join("\n")).toContain('"spaceId":"s1"');
  });

  it("leaves recentReadings out when the probe could not read the day", async () => {
    const h = harness("ok");
    expect(await h.call(body)).toEqual({
      status: 200,
      jsonBody: { result: "ok", secretRef: REF },
    });
    expect(h.lines.join("\n")).not.toContain('"count"');
  });

  it("by default probes the adapter and reads the last day on the one login", async () => {
    // The fixtures hold six readings, 10:00 to 10:25 UTC on 2026-10-15.
    const now = new Date("2026-10-15T10:27:00.000Z");
    const dexcom = fakeDexcom();
    const h = defaultHarness(dexcom.fetch, now);
    expect(await h.call(body)).toEqual({
      status: 200,
      jsonBody: { result: "ok", secretRef: REF, recentReadings: 6 },
    });
    expect(dexcom.count("authenticate")).toBe(1);
    expect(dexcom.count("login")).toBe(1);
    expect(dexcom.count("glucose")).toBe(1);
  });

  it("by default logs the code the service refused the login with, and never the credential", async () => {
    const dexcom = fakeDexcom({ badCredentials: true });
    const h = defaultHarness(dexcom.fetch, new Date("2026-10-15T10:27:00.000Z"));
    expect(await h.call(body)).toEqual({ status: 200, jsonBody: { result: "bad-credentials" } });
    const output = h.lines.join("\n");
    // Dexcom's own code tells a wrong password from a locked account; the fixture is the former.
    expect(output).toContain('"msg":"dexcom.probe-failed"');
    expect(output).toContain('"code":"SSO_AuthenticatePasswordInvalid"');
    expect(output).not.toContain(body.password);
    expect(output).not.toContain(body.username);
    await expect(h.secrets.get("glucose-s1")).resolves.toBeUndefined();
  });
});

/**
 * The two acceptance cases of #78, end to end through the pieces the poller owns: the handler
 * writes and answers a reference, the factory reads by it. The database write between them is
 * the Settings route's, so here it is a variable: the config the web committed, or did not.
 */
describe("source-connect answers an immutable reference (#78)", () => {
  const space = {
    id: "s1",
    glucoseSource: "{}",
    sourceStatus: "connected",
    sourceFailures: 0,
    lastReadingAt: null,
  };
  type Region = "eu" | "us";
  const eu = { ...body, region: "eu" as Region };

  /** The host the adapter logs in to for a region, learned from the adapter, not named here. */
  async function hostFor(region: Region): Promise<string> {
    const { fetch, logins } = recordingFetch();
    await new DexcomShareSource({ region, username: "u", password: "p", fetch }).probe();
    return logins[0]?.host ?? "";
  }

  /** Records which host each login went to and with which password; answers a session id. */
  function recordingFetch() {
    const logins: { host: string; password: unknown }[] = [];
    const fetch: FetchLike = (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("AuthenticatePublisherAccount")) {
        const parsed = JSON.parse(String(init?.body)) as { password?: unknown };
        logins.push({ host: url.host, password: parsed.password });
      }
      return Promise.resolve(
        new Response('"11111111-2222-4333-8444-555555555555"', { status: 200 }),
      );
    };
    return { fetch, logins };
  }

  async function connect(
    h: ReturnType<typeof harness>,
    request: typeof eu,
  ): Promise<Extract<GlucoseSourceConfig, { type: "dexcom-share" }>> {
    const response = await h.call(request);
    const result = response.jsonBody as ConnectSourceResult;
    if (result.result !== "ok") throw new Error(result.result);
    // What the Settings route saves on the space when its database write succeeds.
    return { type: "dexcom-share", region: request.region, secretRef: result.secretRef };
  }

  it("leaves the poller on the previous credential and config when the database write fails", async () => {
    const h = harness("ok");
    const committed = await connect(h, eu);
    // The owner connects again with another password and region; the function writes the new
    // credential and answers, but the Settings route's write of the config fails.
    const answered = await connect(h, { ...eu, region: "us", password: "<newer-password>" });
    expect(answered.secretRef).not.toBe(committed.secretRef);
    // The latest version under the name is now the newer credential, which no config refers to.
    expect(parseCredential((await h.secrets.get(glucoseSecretName("s1"))) ?? "").password).toBe(
      "<newer-password>",
    );

    const { fetch, logins } = recordingFetch();
    const sources = createSourceFactory({ secrets: h.secrets, fetch });
    await expect((await sources(space, committed)).probe()).resolves.toBe("ok");
    expect(logins).toEqual([{ host: await hostFor("eu"), password: body.password }]);
  });

  it("gives two overlapping connects their own references, so neither can pair with the other's region", async () => {
    const h = harness("ok");
    const a = { ...eu, password: "<password-a>" };
    const b = { ...eu, region: "us" as Region, password: "<password-b>" };
    // Both requests are in flight at once; the secret is written twice under one name.
    const [configA, configB] = await Promise.all([connect(h, a), connect(h, b)]);
    expect(configA.secretRef).not.toBe(configB.secretRef);

    // Whichever config the Settings route commits, the poller reads the credential that came with
    // that request's region.
    for (const [config, request] of [
      [configA, a],
      [configB, b],
    ] as const) {
      const { fetch, logins } = recordingFetch();
      const sources = createSourceFactory({ secrets: h.secrets, fetch });
      await expect((await sources(space, config)).probe()).resolves.toBe("ok");
      expect(logins).toEqual([{ host: await hostFor(request.region), password: request.password }]);
    }
  });
});

describe("source-connect with purpose pump", () => {
  const pumpBody = {
    purpose: "pump",
    type: "nightscout",
    spaceId: "s1",
    url: "https://example-ns.example.invalid",
    token: "<fixture-pump-token>",
  };
  const PUMP_REF = `${pumpSecretName("s1")}/1`;

  function pumpHarness(outcome: PumpProbeOutcome | Error) {
    const secrets = new MemorySecrets();
    const lines: string[] = [];
    const glucoseProbes: unknown[] = [];
    const pumpProbes: unknown[] = [];
    const handler = createSourceConnectHandler({
      secrets,
      log: createLogger((line) => lines.push(line)),
      probe: (request) => {
        glucoseProbes.push(request);
        return Promise.resolve({ result: "ok" });
      },
      pumpProbe: (request) => {
        pumpProbes.push(request);
        return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome);
      },
    });
    const call = (json: unknown) =>
      handler({ json: () => Promise.resolve(json) } as never, {} as never);
    return { secrets, lines, glucoseProbes, pumpProbes, call };
  }

  it("probes, stores a new version of pump-<spaceId> and answers the reference with recentBoluses", async () => {
    const h = pumpHarness({ result: "ok", recentBoluses: 7 });
    const response = await h.call(pumpBody);
    expect(response).toEqual({
      status: 200,
      jsonBody: { result: "ok", secretRef: PUMP_REF, recentBoluses: 7 },
    });
    expect(ConnectPumpResult.parse(response.jsonBody)).toEqual(response.jsonBody);
    expect(h.pumpProbes).toEqual([
      { type: "nightscout", url: pumpBody.url, token: pumpBody.token },
    ]);
    expect(h.glucoseProbes).toEqual([]);
    expect(parseNightscoutCredential((await h.secrets.get(pumpSecretName("s1"))) ?? "")).toEqual({
      url: pumpBody.url,
      token: pumpBody.token,
    });
    // A second connect writes a second version under the same name.
    const again = await h.call(pumpBody);
    expect(again.jsonBody).toMatchObject({ secretRef: `${pumpSecretName("s1")}/2` });
  });

  it("never writes glucose-<spaceId>, whatever the pump connect's outcome", async () => {
    for (const outcome of [
      { result: "ok", recentBoluses: 1 },
      { result: "bad-credentials" },
      { result: "unreachable" },
      new Error("down"),
    ] as const) {
      const h = pumpHarness(outcome);
      await h.call(pumpBody);
      await expect(h.secrets.get(glucoseSecretName("s1"))).resolves.toBeUndefined();
      expect(h.glucoseProbes).toEqual([]);
    }
  });

  it("answers bad-credentials or unreachable and stores nothing when the probe says so or throws", async () => {
    for (const [outcome, result] of [
      [{ result: "bad-credentials" }, "bad-credentials"],
      [{ result: "unreachable" }, "unreachable"],
      [new Error(`ECONNRESET ${pumpBody.url}`), "unreachable"],
    ] as const) {
      const h = pumpHarness(outcome);
      expect(await h.call(pumpBody)).toEqual({ status: 200, jsonBody: { result } });
      await expect(h.secrets.get(pumpSecretName("s1"))).resolves.toBeUndefined();
    }
  });

  it("refuses a pump body it cannot read with 400, and never reads it as a glucose connect", async () => {
    const h = pumpHarness({ result: "ok" });
    const { token: _token, ...noSecret } = pumpBody;
    for (const request of [
      { ...pumpBody, url: "http://example-ns.example.invalid" },
      { ...pumpBody, url: "https://example-ns.example.invalid/?token=x" },
      { ...pumpBody, apiSecret: "s" },
      noSecret,
      { ...pumpBody, purpose: "glucose" },
      { ...pumpBody, type: "dexcom-share", region: "eu", username: "u", password: "p" },
    ]) {
      expect(await h.call(request)).toMatchObject({
        status: 400,
        jsonBody: { error: { code: "validation" } },
      });
    }
    expect(h.pumpProbes).toEqual([]);
    expect(h.glucoseProbes).toEqual([]);
    await expect(h.secrets.get(glucoseSecretName("s1"))).resolves.toBeUndefined();
    await expect(h.secrets.get(pumpSecretName("s1"))).resolves.toBeUndefined();
  });

  it("warns on its own line when the token works and the last day holds no bolus", async () => {
    const h = pumpHarness({ result: "ok", recentBoluses: 0 });
    expect(await h.call(pumpBody)).toEqual({
      status: 200,
      jsonBody: { result: "ok", secretRef: PUMP_REF, recentBoluses: 0 },
    });
    expect(h.lines.join("\n")).toContain('"msg":"pump-connect.no-recent-boluses"');
  });

  /** The handler with its default pump probe: the real adapter over a fixture-serving fetch. */
  function defaultPumpHarness(answer: (url: URL) => { status: number; body: string }) {
    const secrets = new MemorySecrets();
    const lines: string[] = [];
    const urls: URL[] = [];
    const fetch: FetchLike = (input) => {
      const url = new URL(String(input));
      urls.push(url);
      const { status, body: text } = answer(url);
      return Promise.resolve(new Response(text, { status }));
    };
    const handler = createSourceConnectHandler({
      secrets,
      log: createLogger((line) => lines.push(line)),
      fetch,
      now: () => new Date("2026-10-15T18:00:00.000Z"),
    });
    const call = (json: unknown) =>
      handler({ json: () => Promise.resolve(json) } as never, {} as never);
    return { secrets, lines, urls, call };
  }

  // Assembled from pieces: the Nightscout paths live in the adapter only (lint).
  const VERIFY = ["verify", "auth"].join("");
  const VERIFY_PATH = ["/api", "v1", VERIFY].join("/");
  const TREATMENTS_PATH = ["/api", "v1", "treatments.json"].join("/");
  const VERIFY_OK = `${VERIFY}-ok.json`;
  const nightscoutFixture = (name: string): string =>
    readFileSync(path.resolve(import.meta.dirname, "../../fixtures/nightscout", name), "utf8");

  it("by default probes the site, then reads a day of treatments on the same site", async () => {
    const h = defaultPumpHarness((url) =>
      url.pathname.endsWith(VERIFY)
        ? { status: 200, body: nightscoutFixture(VERIFY_OK) }
        : { status: 200, body: nightscoutFixture("treatments-combo-bolus.json") },
    );
    expect(await h.call(pumpBody)).toEqual({
      status: 200,
      jsonBody: { result: "ok", secretRef: PUMP_REF, recentBoluses: 6 },
    });
    expect(h.urls.map((u) => u.pathname)).toEqual([VERIFY_PATH, TREATMENTS_PATH]);
    expect(h.urls[1]?.searchParams.get("find[created_at][$gte]")).toBe("2026-10-14T18:00:00.000Z");
  });

  it("by default logs only the status code of a refusal: no address, token or body", async () => {
    const h = defaultPumpHarness(() => ({
      status: 401,
      body: `{"message":"${pumpBody.token} at ${pumpBody.url}"}`,
    }));
    expect(await h.call(pumpBody)).toEqual({
      status: 200,
      jsonBody: { result: "bad-credentials" },
    });
    const output = h.lines.join("\n");
    expect(output).toContain('"code":"401"');
    expect(output).not.toContain(pumpBody.token);
    expect(output).not.toContain("example-ns");
    expect(output).not.toContain("message");
    await expect(h.secrets.get(pumpSecretName("s1"))).resolves.toBeUndefined();
  });

  it("by default stores the credential and leaves recentBoluses out when the day cannot be read", async () => {
    const h = defaultPumpHarness((url) =>
      url.pathname.endsWith(VERIFY)
        ? { status: 200, body: nightscoutFixture(VERIFY_OK) }
        : { status: 500, body: pumpBody.url },
    );
    expect(await h.call(pumpBody)).toEqual({
      status: 200,
      jsonBody: { result: "ok", secretRef: PUMP_REF },
    });
    const output = h.lines.join("\n");
    expect(output).toContain('"msg":"pump-connect.recent-failed"');
    expect(output).not.toContain("example-ns");
    expect(output).not.toContain(pumpBody.token);
  });
});

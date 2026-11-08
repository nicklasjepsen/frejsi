import {
  createLogger,
  LiveRegisterCreated,
  liveSecretName,
  parseNightscoutCredential,
  type FetchLike,
} from "@naensom/shared";
import { MemorySecrets } from "@naensom/shared/secrets/memory";
import { describe, expect, it } from "vitest";

import {
  CHECK_LIMIT,
  clientIp,
  createLiveRegisterHandler,
  createLiveUnregisterHandler,
  deviceSecretMatches,
  hashDeviceSecret,
  nightscoutValidator,
  RateLimiter,
  REQUEST_LIMIT,
  type LiveHttpRequest,
  type NightscoutVerdict,
} from "./register";
import { MemoryLiveStore } from "./store";

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("expected a value");
  return value;
}

const T0 = Date.UTC(2026, 10, 8, 12, 0, 0);
const ID = "0b5c1f7e-3a1d-4c55-9e0a-2f7a7d0e9b11";
const SECRET = "fixture-device-secret-0123456789abcdef";
const START = "b2".repeat(32);
const ACTIVITY = "a1".repeat(32);

const body = {
  nightscoutUrl: "https://ns.example.org",
  nightscoutToken: "fixture-token",
  pushToStartToken: START,
  activityPushToken: ACTIVITY,
  activityStartedAt: "2026-11-08T11:00:00Z",
  deviceToken: null,
  apnsEnvironment: "sandbox",
  unit: "mmolL",
  thresholds: { urgentLowMgdl: 55, lowMgdl: 80, highMgdl: 180, urgentHighMgdl: 260 },
  alertsOn: true,
  language: "da",
};

function request(
  json: unknown,
  headers: Record<string, string> = {},
  params?: Record<string, string>,
): LiveHttpRequest {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    headers: { get: (name) => lower[name.toLowerCase()] ?? null },
    text: () => Promise.resolve(typeof json === "string" ? json : JSON.stringify(json)),
    ...(params === undefined ? {} : { params }),
  };
}

function harness(verdict: NightscoutVerdict = "ok") {
  const store = new MemoryLiveStore();
  const secrets = new MemorySecrets();
  const lines: string[] = [];
  const validated: { url: string; token: string }[] = [];
  let now = T0;
  const requests = new RateLimiter(REQUEST_LIMIT.max, REQUEST_LIMIT.windowMs);
  const checks = new RateLimiter(CHECK_LIMIT.max, CHECK_LIMIT.windowMs);
  const log = createLogger((line) => lines.push(line));
  const register = createLiveRegisterHandler({
    store,
    secrets,
    validate: (url, token) => {
      validated.push({ url, token });
      return Promise.resolve(verdict);
    },
    requests,
    checks,
    now: () => now,
    log,
    newId: () => ID,
    newSecret: () => SECRET,
  });
  const unregister = createLiveUnregisterHandler({ store, secrets, requests, now: () => now, log });
  return {
    store,
    secrets,
    lines,
    validated,
    register,
    unregister,
    setNow: (value: number) => {
      now = value;
    },
  };
}

describe("POST /api/live/register: create", () => {
  it("checks the token, stores address and token in Key Vault, and answers the device secret once", async () => {
    const h = harness();
    const response = await h.register(request(body));
    expect(response.status).toBe(200);
    expect(LiveRegisterCreated.parse(response.jsonBody)).toEqual({
      subscriptionId: ID,
      deviceSecret: SECRET,
    });
    expect(h.validated).toEqual([{ url: "https://ns.example.org", token: "fixture-token" }]);
    const row = must(h.store.rows.get(ID));
    expect(row).toMatchObject({
      isDemo: false,
      nightscoutHost: "ns.example.org",
      tokenSecretRef: `${liveSecretName(ID)}/1`,
      pushToStartToken: START,
      activityPushToken: ACTIVITY,
      activityStartedAt: new Date("2026-11-08T11:00:00Z"),
      deviceToken: null,
      apnsEnvironment: "sandbox",
      lowMgdl: 80,
      highMgdl: 180,
      language: "da",
      nextCheckAt: new Date(T0),
      lastSeenAt: new Date(T0),
    });
    // Only the hash is kept.
    expect(row.deviceSecretHash).toBe(hashDeviceSecret(SECRET));
    expect(JSON.stringify(row)).not.toContain(SECRET);
    expect(JSON.stringify(row)).not.toContain("fixture-token");
    const stored = parseNightscoutCredential(must(await h.secrets.get(must(row.tokenSecretRef))));
    expect(stored).toEqual({ url: "https://ns.example.org", token: "fixture-token" });
  });

  it("creates a demo subscription without a token, a site check or a secret", async () => {
    const h = harness();
    const { nightscoutToken: _token, ...rest } = body;
    const response = await h.register(request({ ...rest, nightscoutUrl: "demo" }));
    expect(response.status).toBe(200);
    expect(h.validated).toEqual([]);
    expect(h.store.rows.get(ID)).toMatchObject({
      isDemo: true,
      nightscoutHost: null,
      tokenSecretRef: null,
    });
  });

  it("answers 422 when Nightscout refuses the token or cannot be reached, and stores nothing", async () => {
    for (const [verdict, code] of [
      ["refused", "nightscout-refused"],
      ["unreachable", "nightscout-unreachable"],
    ] as const) {
      const h = harness(verdict);
      const response = await h.register(request(body));
      expect(response).toEqual({ status: 422, jsonBody: { error: code } });
      expect(h.store.rows.size).toBe(0);
      await expect(h.secrets.get(liveSecretName(ID))).resolves.toBeUndefined();
    }
  });

  it("answers 400 not-https for http, and validation for anything else malformed", async () => {
    const h = harness();
    expect(await h.register(request({ ...body, nightscoutUrl: "http://ns.example.org" }))).toEqual({
      status: 400,
      jsonBody: { error: "not-https" },
    });
    const { nightscoutToken: _token, ...noToken } = body;
    for (const bad of [
      "{",
      "null",
      { ...body, unit: "mmol" },
      { ...body, nightscoutUrl: "ftp://ns.example.org" },
      noToken,
      { ...body, nightscoutUrl: "https://ns.example.org/?token=x" },
      `{"pad":"${"x".repeat(17 * 1024)}"}`,
    ]) {
      const response = await h.register(request(bad));
      expect(response.status, JSON.stringify(bad).slice(0, 60)).toBe(400);
    }
    expect(h.store.rows.size).toBe(0);
    expect(h.validated).toEqual([]);
  });

  it("limits each IP: 10 checks an hour, 60 requests in 10 minutes", async () => {
    const h = harness("refused");
    const from = { "x-forwarded-for": "203.0.113.7:51234" };
    for (let i = 0; i < CHECK_LIMIT.max; i += 1) {
      expect((await h.register(request(body, from))).status).toBe(422);
    }
    expect(await h.register(request(body, from))).toEqual({
      status: 429,
      jsonBody: { error: "rate-limited" },
    });
    expect(h.validated).toHaveLength(CHECK_LIMIT.max);
    // Another address is not affected.
    expect((await h.register(request(body, { "x-forwarded-for": "198.51.100.2" }))).status).toBe(
      422,
    );
    // Requests that need no check are counted too.
    for (let i = 0; i < REQUEST_LIMIT.max - CHECK_LIMIT.max - 1; i += 1) {
      await h.register(request("{", from));
    }
    expect((await h.register(request("{", from))).status).toBe(429);
    // A new window lets the address in again.
    h.setNow(T0 + 61 * 60_000);
    expect((await h.register(request(body, from))).status).toBe(422);
  });
});

describe("POST /api/live/register: update", () => {
  async function created() {
    const h = harness();
    await h.register(request(body));
    h.validated.length = 0;
    h.setNow(T0 + 60_000);
    return h;
  }
  const auth = { "x-device-secret": SECRET };

  it("needs the device secret: a wrong or missing one, or an unknown id, is 401", async () => {
    const h = await created();
    for (const [headers, id] of [
      [{}, ID],
      [{ "x-device-secret": "wrong" }, ID],
      [auth, "00000000-0000-4000-8000-000000000000"],
    ] as const) {
      const response = await h.register(request({ ...body, subscriptionId: id }, headers));
      expect(response).toEqual({ status: 401, jsonBody: { error: "bad-device-secret" } });
    }
  });

  it("moves lastSeenAt and writes the settings without a Nightscout check when the site is unchanged", async () => {
    const h = await created();
    const { nightscoutToken: _token, ...keep } = body;
    const response = await h.register(
      request(
        {
          ...keep,
          subscriptionId: ID,
          unit: "mgdL",
          alertsOn: false,
          language: "en",
          deviceToken: "C3".repeat(32),
          thresholds: { urgentLowMgdl: 60, lowMgdl: 70, highMgdl: 200, urgentHighMgdl: 250 },
        },
        auth,
      ),
    );
    expect(response).toEqual({ status: 200, jsonBody: { subscriptionId: ID } });
    expect(h.validated).toEqual([]);
    expect(h.store.rows.get(ID)).toMatchObject({
      unit: "mgdL",
      alertsOn: false,
      language: "en",
      deviceToken: "c3".repeat(32),
      lowMgdl: 70,
      highMgdl: 200,
      tokenSecretRef: `${liveSecretName(ID)}/1`,
      lastSeenAt: new Date(T0 + 60_000),
    });
  });

  it("checks and stores a new token as a new version, and refuses one Nightscout refuses", async () => {
    const h = await created();
    const ok = await h.register(
      request({ ...body, subscriptionId: ID, nightscoutToken: "fixture-token-2" }, auth),
    );
    expect(ok.status).toBe(200);
    expect(h.validated).toEqual([{ url: "https://ns.example.org", token: "fixture-token-2" }]);
    expect(h.store.rows.get(ID)?.tokenSecretRef).toBe(`${liveSecretName(ID)}/2`);
  });

  it("checks the stored token against a new address", async () => {
    const h = await created();
    const { nightscoutToken: _token, ...keep } = body;
    await h.register(
      request({ ...keep, subscriptionId: ID, nightscoutUrl: "https://other.example.org" }, auth),
    );
    expect(h.validated).toEqual([{ url: "https://other.example.org", token: "fixture-token" }]);
    expect(h.store.rows.get(ID)?.nightscoutHost).toBe("other.example.org");
  });

  it("takes a new activity token and gives it the newest reading on the next run", async () => {
    const h = await created();
    await h.store.update(ID, { lastReadingAt: new Date(T0), nextCheckAt: new Date(T0 + 300_000) });
    await h.register(
      request(
        {
          ...body,
          subscriptionId: ID,
          activityPushToken: "d4".repeat(32),
          activityStartedAt: "2026-11-08T12:01:00Z",
        },
        auth,
      ),
    );
    expect(h.store.rows.get(ID)).toMatchObject({
      activityPushToken: "d4".repeat(32),
      activityStartedAt: new Date("2026-11-08T12:01:00Z"),
      lastReadingAt: null,
      nextCheckAt: new Date(T0 + 60_000),
    });
  });

  it("ignores an activity older than the one the relay restarted, so a restart does not loop", async () => {
    const h = await created();
    // The relay restarted at T0 and cleared the token; the app still reports the old activity.
    await h.store.update(ID, { activityPushToken: null, activityStartedAt: new Date(T0) });
    await h.register(request({ ...body, subscriptionId: ID }, auth));
    expect(h.store.rows.get(ID)).toMatchObject({
      activityPushToken: null,
      activityStartedAt: new Date(T0),
    });
  });

  it("switches to the demo and back, keeping the stored credential (Key Vault soft-deletes names)", async () => {
    const h = await created();
    await h.register(request({ ...body, subscriptionId: ID, nightscoutUrl: "demo" }, auth));
    expect(h.store.rows.get(ID)).toMatchObject({
      isDemo: true,
      tokenSecretRef: `${liveSecretName(ID)}/1`,
    });
    await expect(h.secrets.get(liveSecretName(ID))).resolves.toBeDefined();
    const { nightscoutToken: _token, ...keep } = body;
    const back = await h.register(request({ ...keep, subscriptionId: ID }, auth));
    expect(back.status).toBe(200);
    expect(h.validated).toEqual([]);
    expect(h.store.rows.get(ID)).toMatchObject({
      isDemo: false,
      tokenSecretRef: `${liveSecretName(ID)}/1`,
      lastReadingAt: null,
    });
    // Removing the phone still deletes the credential the demo kept.
    await h.unregister(request("", auth, { subscriptionId: ID }));
    await expect(h.secrets.get(liveSecretName(ID))).resolves.toBeUndefined();
  });

  it("keeps the activity's start time when an update leaves it out for the same token", async () => {
    const h = await created();
    const { activityStartedAt: _started, ...rest } = body;
    await h.register(request({ ...rest, subscriptionId: ID }, auth));
    expect(h.store.rows.get(ID)?.activityStartedAt).toEqual(new Date("2026-11-08T11:00:00Z"));
    await h.register(
      request({ ...rest, subscriptionId: ID, activityPushToken: "e5".repeat(32) }, auth),
    );
    expect(h.store.rows.get(ID)).toMatchObject({
      activityPushToken: "e5".repeat(32),
      activityStartedAt: new Date(T0 + 60_000),
    });
  });

  it("logs the subscription id and a code, never the address, token or secret", async () => {
    const h = await created();
    await h.register(
      request({ ...body, subscriptionId: ID, nightscoutToken: "fixture-token-2" }, auth),
    );
    const text = h.lines.join("\n");
    expect(text).toContain(`"subscriptionId":"${ID}"`);
    for (const secret of ["ns.example.org", "fixture-token", SECRET, START, ACTIVITY]) {
      expect(text).not.toContain(secret);
    }
  });
});

describe("DELETE /api/live/register/{subscriptionId}", () => {
  it("deletes the row and the Key Vault secret with the device secret, 204", async () => {
    const h = harness();
    await h.register(request(body));
    const denied = await h.unregister(
      request("", { "x-device-secret": "wrong" }, { subscriptionId: ID }),
    );
    expect(denied).toEqual({ status: 401, jsonBody: { error: "bad-device-secret" } });
    expect(h.store.rows.has(ID)).toBe(true);
    const response = await h.unregister(
      request("", { "x-device-secret": SECRET }, { subscriptionId: ID }),
    );
    expect(response).toEqual({ status: 204 });
    expect(h.store.rows.has(ID)).toBe(false);
    await expect(h.secrets.get(liveSecretName(ID))).resolves.toBeUndefined();
    // Already gone is also 204.
    expect(
      await h.unregister(request("", { "x-device-secret": SECRET }, { subscriptionId: ID })),
    ).toEqual({ status: 204 });
  });

  it("refuses a malformed id", async () => {
    const h = harness();
    expect(
      (await h.unregister(request("", { "x-device-secret": SECRET }, { subscriptionId: "../x" })))
        .status,
    ).toBe(400);
  });
});

describe("the pieces", () => {
  it("compares the device secret by hash", () => {
    const hash = hashDeviceSecret(SECRET);
    expect(deviceSecretMatches(SECRET, hash)).toBe(true);
    expect(deviceSecretMatches(`${SECRET}x`, hash)).toBe(false);
    expect(deviceSecretMatches(null, hash)).toBe(false);
    expect(deviceSecretMatches("", hash)).toBe(false);
    expect(deviceSecretMatches(SECRET, "abc")).toBe(false);
  });

  it("takes the first forwarded hop without its port", () => {
    const ip = (value?: string) =>
      clientIp(request("", value === undefined ? {} : { "x-forwarded-for": value }));
    expect(ip("203.0.113.7:51234, 10.0.0.1")).toBe("203.0.113.7");
    expect(ip("203.0.113.7")).toBe("203.0.113.7");
    expect(ip("[2001:db8::1]:443")).toBe("2001:db8::1");
    expect(ip("2001:db8::1")).toBe("2001:db8::1");
    expect(ip()).toBe("unknown");
  });

  it("validates by reading one entry: 401 is refused, a timeout or 404 unreachable", async () => {
    const answer =
      (status: number): FetchLike =>
      (input, init) => {
        expect(String(input).endsWith("/sgv.json?count=1")).toBe(true);
        expect(init?.method).toBe("GET");
        return Promise.resolve({ ok: status === 200, status, text: () => Promise.resolve("[]") });
      };
    await expect(nightscoutValidator(answer(200))("https://ns.example.org", "t")).resolves.toBe(
      "ok",
    );
    await expect(nightscoutValidator(answer(401))("https://ns.example.org", "t")).resolves.toBe(
      "refused",
    );
    await expect(nightscoutValidator(answer(404))("https://ns.example.org", "t")).resolves.toBe(
      "unreachable",
    );
    const down: FetchLike = () => Promise.reject(new Error("ECONNREFUSED"));
    await expect(nightscoutValidator(down)("https://ns.example.org", "t")).resolves.toBe(
      "unreachable",
    );
  });
});

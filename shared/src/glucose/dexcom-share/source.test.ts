import { describe, expect, it } from "vitest";

import { createLogger } from "../../log";
import { Reading } from "../../schemas/glucose";
import type { GlucoseSource } from "../types";
import { DexcomShareSource } from "./source";
import { fakeDexcom, fixture } from "./test-server";

/** The fixtures hold six readings, 10:00 to 10:25 UTC on 2026-10-15; the clock is 10:27. */
const now = new Date("2026-10-15T10:27:00.000Z");
const credential = { username: "publisher@example.invalid", password: "<fixture-password>" };

function source(
  fetch: DexcomShareSource["fetch"],
  options: Partial<ConstructorParameters<typeof DexcomShareSource>[0]> = {},
) {
  return new DexcomShareSource({ region: "eu", ...credential, fetch, now: () => now, ...options });
}

describe("DexcomShareSource.fetchSince", () => {
  it("satisfies GlucoseSource", () => {
    const s: GlucoseSource = source(fakeDexcom().fetch);
    expect(typeof s.fetchSince).toBe("function");
    expect(typeof s.probe).toBe("function");
  });

  it("returns only readings newer than since, oldest first, in mmol/L with one decimal", async () => {
    const dexcom = fakeDexcom();
    const readings = await source(dexcom.fetch).fetchSince(new Date("2026-10-15T10:10:00.000Z"));
    expect(readings.map((r) => r.mmol)).toEqual([7.3, 7.7, 8.0]);
    expect(readings.map((r) => r.ts)).toEqual([
      "2026-10-15T10:15:00.000Z",
      "2026-10-15T10:20:00.000Z",
      "2026-10-15T10:25:00.000Z",
    ]);
    for (const reading of readings) expect(Reading.safeParse(reading).success).toBe(true);
  });

  it("converts every fixture value with mg/dL ÷ 18.016", async () => {
    const readings = await source(fakeDexcom().fetch).fetchSince(new Date(0));
    expect(readings.map((r) => r.mmol)).toEqual([6.2, 6.5, 7.0, 7.3, 7.7, 8.0]);
  });

  it("maps the string trend form to Trend", async () => {
    const readings = await source(fakeDexcom({ trendFormat: "string" }).fetch).fetchSince(
      new Date(0),
    );
    expect(readings.map((r) => r.trend)).toEqual([
      "flat",
      "forty-five-up",
      "single-up",
      "forty-five-up",
      "flat",
      "forty-five-down",
    ]);
  });

  it("maps the numeric trend form to the same Trend values", async () => {
    const readings = await source(fakeDexcom({ trendFormat: "numeric" }).fetch).fetchSince(
      new Date(0),
    );
    expect(readings.map((r) => r.trend)).toEqual([
      "flat",
      "forty-five-up",
      "single-up",
      "forty-five-up",
      "flat",
      "forty-five-down",
    ]);
  });

  it("uses the EU host for region eu and the US host for region us", async () => {
    const eu = fakeDexcom();
    await source(eu.fetch, { region: "eu" }).fetchSince(now);
    expect(eu.calls.every((c) => c.url.host === "shareous1.dexcom.com")).toBe(true);
    const us = fakeDexcom();
    await source(us.fetch, { region: "us" }).fetchSince(now);
    expect(us.calls.every((c) => c.url.host === "share2.dexcom.com")).toBe(true);
  });

  it("asks for the window since as minutes and one reading per five minutes", async () => {
    const dexcom = fakeDexcom();
    const s = source(dexcom.fetch);
    await s.fetchSince(new Date(now.getTime() - 30 * 60_000));
    await s.fetchSince(new Date(now.getTime() - 1440 * 60_000));
    await s.fetchSince(new Date(0));
    const windows = dexcom.calls
      .filter((c) => c.url.pathname.endsWith("ReadPublisherLatestGlucoseValues"))
      .map((c) => `${c.url.searchParams.get("minutes")}/${c.url.searchParams.get("maxCount")}`);
    expect(windows).toEqual(["30/6", "1440/288", "1440/288"]);
  });

  it("sends the credential and the application id in the body, not the query string", async () => {
    const dexcom = fakeDexcom();
    await source(dexcom.fetch).fetchSince(now);
    const auth = dexcom.calls.find((c) => c.url.pathname.endsWith("AuthenticatePublisherAccount"));
    expect(auth?.body).toEqual({
      accountName: credential.username,
      password: credential.password,
      applicationId: expect.stringMatching(/^[0-9a-f-]{36}$/) as string,
    });
    expect([...(auth?.url.searchParams.keys() ?? [])]).toEqual([]);
  });
});

describe("DexcomShareSource session", () => {
  it("logs in once and reuses the session id across fetches", async () => {
    const dexcom = fakeDexcom();
    const s = source(dexcom.fetch);
    await s.fetchSince(now);
    await s.fetchSince(now);
    await s.fetchSince(now);
    expect(dexcom.count("authenticate")).toBe(1);
    expect(dexcom.count("login")).toBe(1);
    expect(dexcom.count("glucose")).toBe(3);
    const sessionIds = dexcom.calls
      .filter((c) => c.url.pathname.endsWith("ReadPublisherLatestGlucoseValues"))
      .map((c) => c.url.searchParams.get("sessionId"));
    expect(sessionIds).toEqual(Array<string>(3).fill(JSON.parse(fixture("login")) as string));
  });

  it("renews the session once on SessionNotValid and retries", async () => {
    const dexcom = fakeDexcom({ staleSessions: 1 });
    const s = source(dexcom.fetch);
    await s.fetchSince(now);
    const readings = await s.fetchSince(new Date(0));
    expect(readings).toHaveLength(6);
    expect(dexcom.count("login")).toBe(2);
    expect(dexcom.count("glucose")).toBe(3);
  });

  it("gives up after one renewal so a broken account cannot loop", async () => {
    const dexcom = fakeDexcom({ staleSessions: 5 });
    await expect(source(dexcom.fetch).fetchSince(now)).rejects.toMatchObject({
      name: "DexcomShareError",
      code: "SessionNotValid",
    });
    expect(dexcom.count("login")).toBe(2);
    expect(dexcom.count("glucose")).toBe(2);
  });
});

describe("DexcomShareSource.probe", () => {
  it("is ok with the fixtures", async () => {
    await expect(source(fakeDexcom().fetch).probe()).resolves.toBe("ok");
  });

  it("is bad-credentials when authentication fails", async () => {
    await expect(source(fakeDexcom({ badCredentials: true }).fetch).probe()).resolves.toBe(
      "bad-credentials",
    );
  });

  it("is unreachable on a network error", async () => {
    await expect(source(fakeDexcom({ networkError: true }).fetch).probe()).resolves.toBe(
      "unreachable",
    );
  });

  it("is unreachable on a server error that is not an authentication failure", async () => {
    await expect(source(fakeDexcom({ serverError: true }).fetch).probe()).resolves.toBe(
      "unreachable",
    );
  });

  it("stores nothing: a probe does not keep the session for later fetches", async () => {
    const dexcom = fakeDexcom();
    const s = source(dexcom.fetch);
    await s.probe();
    await s.fetchSince(now);
    expect(dexcom.count("login")).toBe(2);
  });
});

describe("DexcomShareSource and the logger", () => {
  it("never writes the password, the username, a session id or a response body", async () => {
    const lines: string[] = [];
    const log = createLogger((line) => lines.push(line));
    const stale = fakeDexcom({ staleSessions: 5 });
    await source(stale.fetch, { log })
      .fetchSince(now)
      .catch(() => undefined);
    const bad = fakeDexcom({ badCredentials: true });
    await source(bad.fetch, { log }).probe();
    const down = fakeDexcom({ networkError: true });
    await source(down.fetch, { log }).probe();
    const html = fakeDexcom({ serverError: true });
    await source(html.fetch, { log }).probe();

    expect(lines.length).toBeGreaterThan(0);
    const output = lines.join("\n");
    expect(output).not.toContain(credential.password);
    expect(output).not.toContain(credential.username);
    expect(output).not.toContain(JSON.parse(fixture("login")) as string);
    expect(output).not.toContain(JSON.parse(fixture("authenticate")) as string);
    expect(output).not.toContain("Session ID is not valid");
    expect(output).not.toContain("Publisher account password failed");
    expect(output).not.toContain("Service Unavailable");
    expect(output).not.toContain("fetch failed");
  });

  it("throws errors whose message carries the code only, never the response body", async () => {
    const dexcom = fakeDexcom({ badCredentials: true });
    const error: unknown = await source(dexcom.fetch)
      .fetchSince(now)
      .then(() => null)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("SSO_AuthenticatePasswordInvalid");
    expect((error as Error).message).not.toContain("password failed");
  });
});

describe("DexcomShareSource deadline", () => {
  /** Accepts the connection and never answers, until the signal aborts it. */
  const stalled: DexcomShareSource["fetch"] = (_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new Error("aborted", { cause: init.signal?.reason }));
      });
    });

  it("gives every call a deadline, so a stalled service is unreachable rather than a hang", async () => {
    const s = source(stalled, { timeoutMs: 20 });
    await expect(s.probe()).resolves.toBe("unreachable");
    await expect(s.fetchSince(now)).rejects.toMatchObject({
      name: "DexcomShareError",
      code: "Timeout",
    });
  });

  it("passes an abort signal on every request", async () => {
    const dexcom = fakeDexcom();
    const signals: unknown[] = [];
    const spy: DexcomShareSource["fetch"] = (input, init) => {
      signals.push(init?.signal);
      return dexcom.fetch(input, init);
    };
    await source(spy).fetchSince(now);
    expect(signals).toHaveLength(3);
    expect(signals.every((sig) => sig instanceof AbortSignal)).toBe(true);
  });
});

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createLogger } from "../../log";
import { mgdlToMmol } from "../units";
import { NightscoutError, NightscoutSource } from "./source";
import type { FetchLike } from "./transport";

const fixturesDir = path.resolve(import.meta.dirname, "../../../../fixtures/nightscout");
const fixture = (name: string): string => readFileSync(path.join(fixturesDir, name), "utf8");

const BASE = "https://example-ns.example.invalid";
const SECRET_TOKEN = "fixture-token-xyz";
const API_SECRET = "fixture-api-secret";
const now = new Date("2026-10-15T10:27:00.000Z");
const MINUTE = 60_000;

interface Call {
  url: URL;
  headers: Record<string, string>;
  method: string;
  redirect: string | undefined;
}

/** A fetch that serves one response and records every request it saw. */
function recording(response: { status?: number; body?: string } | Error | "hang") {
  const calls: Call[] = [];
  const fetch: FetchLike = (input, init) => {
    calls.push({
      url: new URL(String(input)),
      headers: init?.headers ?? {},
      method: init?.method ?? "GET",
      redirect: init?.redirect,
    });
    if (response === "hang") {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    }
    if (response instanceof Error) return Promise.reject(response);
    const status = response.status ?? 200;
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      text: () => Promise.resolve(response.body ?? ""),
    });
  };
  return { fetch, calls };
}

function source(
  response: Parameters<typeof recording>[0],
  options: Partial<ConstructorParameters<typeof NightscoutSource>[0]> = {},
) {
  const r = recording(response);
  const lines: string[] = [];
  const s = new NightscoutSource({
    url: BASE,
    token: SECRET_TOKEN,
    fetch: r.fetch,
    now: () => now,
    log: createLogger(
      (line) => lines.push(line),
      () => now,
    ),
    ...options,
  });
  return { source: s, ...r, lines };
}

describe("NightscoutSource.fetchSince", () => {
  it("asks entries/sgv.json for entries since the window, count from the window", async () => {
    const h = source({ body: "[]" });
    const since = new Date(now.getTime() - 30 * MINUTE);
    await h.source.fetchSince(since);
    const [call] = h.calls;
    expect(call?.method).toBe("GET");
    expect(`${call?.url.origin}${call?.url.pathname}`).toBe(`${BASE}/api/v1/entries/sgv.json`);
    expect(call?.url.searchParams.get("find[date][$gte]")).toBe(String(since.getTime()));
    expect(call?.url.searchParams.get("count")).toBe("6");

    const day = source({ body: "[]" });
    await day.source.fetchSince(new Date(now.getTime() - 1440 * MINUTE));
    expect(day.calls[0]?.url.searchParams.get("count")).toBe("288");
  });

  it("keeps a path in the site address", async () => {
    const h = source({ body: "[]" }, { url: `${BASE}/ns/` });
    await h.source.fetchSince(new Date(now.getTime() - 30 * MINUTE));
    expect(h.calls[0]?.url.pathname).toBe("/ns/api/v1/entries/sgv.json");
  });

  it("returns valid entries oldest first, one per date, mapped to mmol and trend", async () => {
    const h = source({ body: fixture("entries.json") });
    const readings = await h.source.fetchSince(new Date("2026-10-15T09:00:00.000Z"));
    expect(readings.map((r) => r.trend)).toEqual([
      "double-up",
      "single-up",
      "forty-five-up",
      "flat",
      "forty-five-down",
      "single-down",
      "double-down",
      "rate-out-of-range",
      "not-computable", // NONE
      "not-computable", // NOT COMPUTABLE
      "flat",
    ]);
    const times = readings.map((r) => Date.parse(r.ts));
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(new Set(times).size).toBe(times.length);
    expect(readings[0]).toEqual({
      ts: "2026-10-15T10:00:00.000Z",
      mmol: mgdlToMmol(180),
      trend: "double-up",
    });
    expect(readings[0]?.mmol).toBe(10);
  });

  it("returns only entries newer than since", async () => {
    const h = source({ body: fixture("entries.json") });
    const readings = await h.source.fetchSince(new Date("2026-10-15T10:45:00.000Z"));
    expect(readings.map((r) => r.ts)).toEqual(["2026-10-15T10:50:00.000Z"]);
  });

  it("drops entries without sgv, without date, and of another type", async () => {
    const entries = [
      { type: "sgv", sgv: 100, date: Date.parse("2026-10-15T10:10:00Z"), direction: "Flat" },
      { type: "sgv", date: Date.parse("2026-10-15T10:11:00Z"), direction: "Flat" },
      { type: "sgv", sgv: 100, direction: "Flat" },
      { type: "mbg", sgv: 100, date: Date.parse("2026-10-15T10:12:00Z") },
      { type: "cal", sgv: 100, date: Date.parse("2026-10-15T10:13:00Z") },
    ];
    const h = source({ body: JSON.stringify(entries) });
    const readings = await h.source.fetchSince(new Date("2026-10-15T10:00:00Z"));
    expect(readings.map((r) => r.ts)).toEqual(["2026-10-15T10:10:00.000Z"]);
  });

  it("maps a missing direction to not-computable and an empty answer to nothing", async () => {
    const missing = source({ body: fixture("entries-missing-direction.json") });
    const readings = await missing.source.fetchSince(new Date("2026-10-15T09:00:00.000Z"));
    expect(readings).toHaveLength(3);
    expect(readings.every((r) => r.trend === "not-computable")).toBe(true);

    const empty = source({ body: fixture("entries-empty.json") });
    expect(await empty.source.fetchSince(new Date("2026-10-15T09:00:00.000Z"))).toEqual([]);
  });

  it("fails with the HTTP status as the code on 401, and with no URL, token or body in it", async () => {
    const h = source({ status: 401, body: `{"message":"secret ${SECRET_TOKEN} ${BASE}"}` });
    const error = await h.source
      .fetchSince(new Date(now.getTime() - 30 * MINUTE))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NightscoutError);
    expect((error as NightscoutError).code).toBe("401");
    expect((error as Error).message).not.toMatch(/example-ns|fixture-token/);
    expect(h.lines.join("\n")).not.toMatch(/example-ns|fixture-token|secret/);
  });

  it("fails with UnexpectedShape on a body that is not a list, Timeout when the site stalls, Network when it is down", async () => {
    const since = new Date(now.getTime() - 30 * MINUTE);
    const shape = await source({ body: '{"a":1}' })
      .source.fetchSince(since)
      .catch((e: unknown) => e);
    expect((shape as NightscoutError).code).toBe("UnexpectedShape");
    const html = await source({ body: "<html>" })
      .source.fetchSince(since)
      .catch((e: unknown) => e);
    expect((html as NightscoutError).code).toBe("UnexpectedShape");
    const slow = await source("hang", { timeoutMs: 20 })
      .source.fetchSince(since)
      .catch((e: unknown) => e);
    expect((slow as NightscoutError).code).toBe("Timeout");
    const down = await source(new TypeError(`fetch failed ${BASE}`))
      .source.fetchSince(since)
      .catch((e: unknown) => e);
    expect((down as NightscoutError).code).toBe("Network");
    expect((down as Error).message).not.toContain("example-ns");
  });
});

describe("NightscoutSource authentication", () => {
  it("sends the access token verbatim in the api-secret header and not in the URL", async () => {
    const h = source({ body: "[]" });
    await h.source.fetchSince(new Date(now.getTime() - 30 * MINUTE));
    await h.source.probe();
    expect(h.calls).toHaveLength(2);
    for (const call of h.calls) {
      expect(call.headers["api-secret"]).toBe(SECRET_TOKEN);
      expect(call.url.href).not.toContain(SECRET_TOKEN);
      expect(call.redirect).toBe("manual");
    }
  });

  it("sends the SHA-1 hex of the API secret, never the secret itself", async () => {
    const h = source({ body: "[]" }, { token: undefined, apiSecret: API_SECRET });
    await h.source.fetchSince(new Date(now.getTime() - 30 * MINUTE));
    const hash = createHash("sha1").update(API_SECRET).digest("hex");
    expect(h.calls[0]?.headers["api-secret"]).toBe(hash);
    expect(h.calls[0]?.url.href).not.toContain(API_SECRET);
    expect(h.calls[0]?.url.href).not.toContain(hash);
    expect(JSON.stringify(h.calls[0]?.headers)).not.toContain(API_SECRET);
  });
});

describe("NightscoutSource.probe", () => {
  it("is ok for the new and the legacy verifyauth answer", async () => {
    expect(await source({ body: fixture("verifyauth-ok.json") }).source.probe()).toBe("ok");
    expect(await source({ body: fixture("verifyauth-legacy-ok.json") }).source.probe()).toBe("ok");
  });

  it("calls verifyauth with GET", async () => {
    const h = source({ body: fixture("verifyauth-ok.json") });
    await h.source.probe();
    expect(h.calls[0]?.method).toBe("GET");
    expect(h.calls[0]?.url.pathname).toBe("/api/v1/verifyauth");
  });

  it("is bad-credentials for UNAUTHORIZED, canRead false, 401 and 403", async () => {
    expect(await source({ body: fixture("verifyauth-unauthorized.json") }).source.probe()).toBe(
      "bad-credentials",
    );
    expect(await source({ body: fixture("verifyauth-cannot-read.json") }).source.probe()).toBe(
      "bad-credentials",
    );
    expect(await source({ status: 401, body: "" }).source.probe()).toBe("bad-credentials");
    expect(await source({ status: 403, body: "" }).source.probe()).toBe("bad-credentials");
  });

  it("is unreachable for a network error, a timeout, a body that is not JSON, a redirect and a server error", async () => {
    expect(await source(new TypeError("fetch failed")).source.probe()).toBe("unreachable");
    expect(await source("hang", { timeoutMs: 20 }).source.probe()).toBe("unreachable");
    expect(await source({ body: "<html>login</html>" }).source.probe()).toBe("unreachable");
    expect(await source({ status: 302, body: "" }).source.probe()).toBe("unreachable");
    expect(await source({ status: 301, body: fixture("verifyauth-ok.json") }).source.probe()).toBe(
      "unreachable",
    );
    expect(await source({ status: 500, body: "" }).source.probe()).toBe("unreachable");
    expect(await source({ body: '{"message":42}' }).source.probe()).toBe("unreachable");
  });

  it("logs codes only: no URL, token or response body", async () => {
    const h = source({ status: 401, body: `{"message":"${SECRET_TOKEN} ${BASE}"}` });
    await h.source.probe();
    const out = h.lines.join("\n");
    expect(out).toContain("401");
    expect(out).not.toMatch(/example-ns|fixture-token/);
  });
});

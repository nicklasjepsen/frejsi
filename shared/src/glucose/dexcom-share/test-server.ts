import { readFileSync } from "node:fs";
import path from "node:path";

import type { FetchLike } from "./source";

/**
 * A fake of the Dexcom Share service over the recorded fixtures, for tests in this directory.
 * It never reaches the network: the adapter is handed `fetch` and this is what the tests pass.
 */
const fixturesDir = path.resolve(import.meta.dirname, "../../../../fixtures/dexcom-share");

export function fixture(name: string): string {
  return readFileSync(path.join(fixturesDir, `${name}.json`), "utf8");
}

export interface FakeDexcomOptions {
  /** Which glucose fixture the Publisher call answers with. */
  trendFormat?: "string" | "numeric";
  /** The glucose call answers SessionNotValid this many times before it works. */
  staleSessions?: number;
  /** Authenticate answers the bad-credentials fixture. */
  badCredentials?: boolean;
  /** Every call rejects, as `fetch` does when the host is unreachable. */
  networkError?: boolean;
  /** Authenticate answers HTTP 500 with a body nobody expects. */
  serverError?: boolean;
}

export interface FakeDexcom {
  fetch: FetchLike;
  calls: { url: URL; method: string | undefined; body: unknown }[];
  count(endpoint: "authenticate" | "login" | "glucose"): number;
}

const ENDPOINTS = {
  authenticate: "/ShareWebServices/Services/General/AuthenticatePublisherAccount",
  login: "/ShareWebServices/Services/General/LoginPublisherAccountById",
  glucose: "/ShareWebServices/Services/Publisher/ReadPublisherLatestGlucoseValues",
} as const;

function json(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "application/json" } });
}

export function fakeDexcom(options: FakeDexcomOptions = {}): FakeDexcom {
  const calls: FakeDexcom["calls"] = [];
  let staleSessions = options.staleSessions ?? 0;
  const glucoseFixture =
    options.trendFormat === "numeric"
      ? "latest-glucose-numeric-trend"
      : "latest-glucose-string-trend";

  const fetch: FetchLike = (input, init) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({ url, method: init?.method, body });
    if (options.networkError) return Promise.reject(new TypeError("fetch failed"));

    switch (url.pathname) {
      case ENDPOINTS.authenticate:
        if (options.badCredentials) return Promise.resolve(json(fixture("bad-credentials"), 500));
        if (options.serverError)
          return Promise.resolve(json("<html>Service Unavailable</html>", 503));
        return Promise.resolve(json(fixture("authenticate")));
      case ENDPOINTS.login:
        return Promise.resolve(json(fixture("login")));
      case ENDPOINTS.glucose:
        if (staleSessions > 0) {
          staleSessions -= 1;
          return Promise.resolve(json(fixture("session-not-valid"), 500));
        }
        return Promise.resolve(json(fixture(glucoseFixture)));
      default:
        return Promise.resolve(json('{"Code":"NotFound"}', 404));
    }
  };

  return {
    fetch,
    calls,
    count: (endpoint) => calls.filter((c) => c.url.pathname === ENDPOINTS[endpoint]).length,
  };
}

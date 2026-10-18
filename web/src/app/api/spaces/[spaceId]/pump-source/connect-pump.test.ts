// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { connectPump } from "./connect-pump";

const REQUEST = {
  purpose: "pump" as const,
  type: "nightscout" as const,
  spaceId: "s1",
  url: "https://nightscout.example.test",
  token: "example-ns-token-0123",
};
const ENV = {
  SOURCE_CONNECT_URL: "https://functions.example/api/source-connect",
  SOURCE_CONNECT_KEY: "example-function-key",
};

const fetching = (answer: Response | Error) => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = vi.fn((url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
};

describe("connectPump (the pump-source route → source-connect with purpose pump, plan §4, §5)", () => {
  it("POSTs the ConnectPumpRequest as JSON with the function key and parses a ConnectPumpResult", async () => {
    const { fetchImpl, calls } = fetching(
      Response.json({ result: "ok", secretRef: "pump-s1/abc", recentBoluses: 4 }),
    );
    expect(await connectPump(REQUEST, ENV, fetchImpl)).toEqual({
      result: "ok",
      secretRef: "pump-s1/abc",
      recentBoluses: 4,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(ENV.SOURCE_CONNECT_URL);
    expect(calls[0]?.init.method).toBe("POST");
    const headers = new Headers(calls[0]?.init.headers);
    expect(headers.get("x-functions-key")).toBe("example-function-key");
    expect(headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual(REQUEST);
  });

  it("passes bad-credentials through and sends no key header when none is configured", async () => {
    const { fetchImpl, calls } = fetching(Response.json({ result: "bad-credentials" }));
    expect(
      await connectPump(REQUEST, { SOURCE_CONNECT_URL: ENV.SOURCE_CONNECT_URL }, fetchImpl),
    ).toEqual({ result: "bad-credentials" });
    expect(new Headers(calls[0]?.init.headers).has("x-functions-key")).toBe(false);
  });

  it("is unreachable with its cause for every answer that is not a clean ConnectPumpResult", async () => {
    const cases: [Response | Error, string][] = [
      [new Error("ECONNREFUSED"), "network"],
      [new Response("<html>oops</html>", { status: 502 }), "http-502"],
      [Response.json({ nonsense: true }), "bad-body"],
      [new Response("not json", { status: 200 }), "bad-body"],
      [Response.json({ result: "unreachable" }), "source-unreachable"],
      [Object.assign(new Error("timed out"), { name: "TimeoutError" }), "timeout"],
    ];
    for (const [answer, cause] of cases) {
      const { fetchImpl } = fetching(answer);
      expect(await connectPump(REQUEST, ENV, fetchImpl)).toEqual({ result: "unreachable", cause });
    }
  });

  it("is unreachable (not-configured) without a URL, and never calls fetch", async () => {
    const { fetchImpl, calls } = fetching(Response.json({ result: "ok", secretRef: "pump-s1" }));
    expect(await connectPump(REQUEST, {}, fetchImpl)).toEqual({
      result: "unreachable",
      cause: "not-configured",
    });
    expect(calls).toEqual([]);
  });

  it("refuses a glucose-shaped answer: a ConnectSourceResult with recentReadings is a bad body", async () => {
    const { fetchImpl } = fetching(
      Response.json({ result: "ok", secretRef: "glucose-s1", recentReadings: 3 }),
    );
    expect(await connectPump(REQUEST, ENV, fetchImpl)).toEqual({
      result: "unreachable",
      cause: "bad-body",
    });
  });
});

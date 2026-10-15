// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { connectSource, type ConnectSourceEnv } from "./source-connect-client";

const REQUEST = {
  spaceId: "s1",
  type: "dexcom-share" as const,
  region: "eu" as const,
  username: "example-publisher",
  password: "example-secret-pass",
};
const ENV: ConnectSourceEnv = {
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

describe("connectSource (the Settings route → source-connect contract, plan §4, §7)", () => {
  it("POSTs the ConnectSourceRequest as JSON with the function key and parses the result", async () => {
    const { fetchImpl, calls } = fetching(Response.json({ result: "ok", secretRef: "glucose-s1" }));
    const result = await connectSource(REQUEST, ENV, fetchImpl);
    expect(result).toEqual({ result: "ok", secretRef: "glucose-s1" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(ENV.SOURCE_CONNECT_URL);
    expect(calls[0]?.init.method).toBe("POST");
    expect(new Headers(calls[0]?.init.headers).get("x-functions-key")).toBe("example-function-key");
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual(REQUEST);
  });

  it("sends no key header when none is configured (local development)", async () => {
    const { fetchImpl, calls } = fetching(Response.json({ result: "bad-credentials" }));
    const result = await connectSource(
      REQUEST,
      { SOURCE_CONNECT_URL: "http://localhost:7071/api/source-connect" },
      fetchImpl,
    );
    expect(result).toEqual({ result: "bad-credentials" });
    expect(new Headers(calls[0]?.init.headers).has("x-functions-key")).toBe(false);
  });

  it("is unreachable when the URL is not configured, and never calls fetch", async () => {
    const { fetchImpl, calls } = fetching(Response.json({ result: "ok", secretRef: "x" }));
    expect(await connectSource(REQUEST, {}, fetchImpl)).toEqual({ result: "unreachable" });
    expect(await connectSource(REQUEST, { SOURCE_CONNECT_URL: "" }, fetchImpl)).toEqual({
      result: "unreachable",
    });
    expect(calls).toEqual([]);
  });

  it("is unreachable on a network error, a non-2xx answer or a body that is not a ConnectSourceResult", async () => {
    expect(await connectSource(REQUEST, ENV, fetching(new Error("ECONNRESET")).fetchImpl)).toEqual(
      { result: "unreachable" },
    );
    expect(
      await connectSource(
        REQUEST,
        ENV,
        fetching(new Response("Service Unavailable", { status: 503 })).fetchImpl,
      ),
    ).toEqual({ result: "unreachable" });
    expect(
      await connectSource(REQUEST, ENV, fetching(Response.json({ result: "maybe" })).fetchImpl),
    ).toEqual({ result: "unreachable" });
    expect(
      await connectSource(REQUEST, ENV, fetching(new Response("not json")).fetchImpl),
    ).toEqual({ result: "unreachable" });
  });
});

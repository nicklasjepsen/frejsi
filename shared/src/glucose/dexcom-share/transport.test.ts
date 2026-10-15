import { describe, expect, it } from "vitest";

import { ENDPOINTS } from "./protocol";
import {
  READ_ONLY_ENDPOINTS,
  ReadOnlyEndpointError,
  sendShareRequest,
  type FetchLike,
} from "./transport";

const BASE = "/ShareWebServices/Services";

/** Records every call and answers nothing useful; a refused request must never reach it. */
function spy() {
  const calls: { url: string; method: string | undefined }[] = [];
  const fetch: FetchLike = (input, init) => {
    calls.push({ url: input.toString(), method: init?.method });
    return Promise.resolve(new Response("[]", { status: 200 }));
  };
  return { fetch, calls };
}

const signal = AbortSignal.timeout(1000);

describe("Dexcom Share transport allow-list", () => {
  it("lists exactly the authentication calls and the latest-values read, all POST", () => {
    expect(Object.fromEntries(READ_ONLY_ENDPOINTS)).toEqual({
      [`${BASE}/General/AuthenticatePublisherAccount`]: "POST",
      [`${BASE}/General/LoginPublisherAccountById`]: "POST",
      [`${BASE}/Publisher/ReadPublisherLatestGlucoseValues`]: "POST",
    });
    for (const endpoint of Object.values(ENDPOINTS)) {
      expect(READ_ONLY_ENDPOINTS.get(endpoint.path)).toBe(endpoint.method);
    }
  });

  it("sends an allow-listed endpoint with its method, query and body", async () => {
    const { fetch, calls } = spy();
    const query = new URLSearchParams({ sessionId: "s", minutes: "30", maxCount: "6" });
    await sendShareRequest(fetch, { region: "eu", ...ENDPOINTS.glucose, query, signal });
    await sendShareRequest(fetch, {
      region: "us",
      ...ENDPOINTS.authenticate,
      body: { accountName: "a" },
      signal,
    });
    expect(calls).toEqual([
      {
        url: `https://shareous1.dexcom.com${BASE}/Publisher/ReadPublisherLatestGlucoseValues?sessionId=s&minutes=30&maxCount=6`,
        method: "POST",
      },
      {
        url: `https://share2.dexcom.com${BASE}/General/AuthenticatePublisherAccount`,
        method: "POST",
      },
    ]);
  });

  const writes = [
    `${BASE}/Publisher/PostReceiverEgvRecords`,
    `${BASE}/Publisher/CreateSubscriptionInvitation`,
    `${BASE}/Publisher/DeleteSubscription`,
    `${BASE}/Publisher/ReadPublisherSubscriptions`,
    `${BASE}/Publisher/CreateContact`,
    `${BASE}/Publisher/DeleteContact`,
    `${BASE}/Publisher/ReplacePublisherContact`,
    `${BASE}/Publisher/UpdateSubscriberAlertSettings`,
    `${BASE}/Subscriber/UpdateSubscriberAlertSettings`,
    `${BASE}/General/DeletePublisherAccount`,
  ];

  it.each(writes)("refuses %s without sending anything", async (path) => {
    const { fetch, calls } = spy();
    await expect(
      sendShareRequest(fetch, { region: "eu", path, method: "POST", signal }),
    ).rejects.toBeInstanceOf(ReadOnlyEndpointError);
    expect(calls).toEqual([]);
  });

  it("refuses any Subscription, Contact or AlertSettings path under any prefix", async () => {
    const { fetch, calls } = spy();
    for (const path of writes) {
      if (!/Subscription|Contact|AlertSettings/.test(path)) continue;
      await expect(
        sendShareRequest(fetch, { region: "eu", path, method: "GET", signal }),
      ).rejects.toThrow(ReadOnlyEndpointError);
    }
    expect(calls).toEqual([]);
  });

  it("refuses an allow-listed path with another method, a query baked in, or a dot segment", async () => {
    const { fetch, calls } = spy();
    const read = ENDPOINTS.glucose.path;
    const attempts = [
      { path: read, method: "GET" },
      { path: read, method: "PUT" },
      { path: `${read}?sessionId=s`, method: "POST" },
      { path: `${read}/../PostReceiverEgvRecords`, method: "POST" },
      { path: read.toLowerCase(), method: "POST" },
      { path: `${read}/`, method: "POST" },
      { path: "", method: "POST" },
    ];
    for (const attempt of attempts) {
      await expect(
        sendShareRequest(fetch, { region: "eu", ...attempt, signal }),
      ).rejects.toBeInstanceOf(ReadOnlyEndpointError);
    }
    expect(calls).toEqual([]);
  });

  it("names the refused call and the rule, never a credential or a body", async () => {
    const { fetch } = spy();
    const error: unknown = await sendShareRequest(fetch, {
      region: "eu",
      path: `${BASE}/Publisher/PostReceiverEgvRecords`,
      method: "POST",
      body: { password: "<fixture-password>" },
      signal,
    }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ReadOnlyEndpointError);
    expect((error as Error).message).toContain(
      "POST /ShareWebServices/Services/Publisher/PostReceiverEgvRecords",
    );
    expect((error as Error).message).toContain("read-only");
    expect((error as Error).message).not.toContain("<fixture-password>");
  });

  it("cannot have an endpoint added at runtime", () => {
    expect(Object.isFrozen(READ_ONLY_ENDPOINTS)).toBe(true);
    expect(() =>
      (READ_ONLY_ENDPOINTS as Map<string, string>).set(
        `${BASE}/Publisher/PostReceiverEgvRecords`,
        "POST",
      ),
    ).toThrow();
    expect(READ_ONLY_ENDPOINTS.size).toBe(3);
  });
});

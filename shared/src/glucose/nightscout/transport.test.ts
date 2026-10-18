import { describe, expect, it } from "vitest";

import { ENDPOINTS } from "./protocol";
import { READ_ONLY_ENDPOINTS, ReadOnlyEndpointError, sendNightscoutRequest } from "./transport";

const base = {
  baseUrl: "https://example-ns.example.invalid",
  auth: { token: "t" },
  signal: new AbortController().signal,
};
const never = () => Promise.reject(new Error("fetch must not be called"));

describe("the Nightscout read-only allow-list", () => {
  it("holds the three GET reads and nothing else", () => {
    expect([...READ_ONLY_ENDPOINTS.entries()].sort()).toEqual([
      ["/api/v1/entries/sgv.json", "GET"],
      ["/api/v1/treatments.json", "GET"],
      ["/api/v1/verifyauth", "GET"],
    ]);
    expect(
      () =>
        READ_ONLY_ENDPOINTS instanceof Map &&
        (READ_ONLY_ENDPOINTS as Map<string, string>).set("/api/v1/treatments", "POST"),
    ).toThrow();
  });

  it.each([
    ["POST", "/api/v1/entries/sgv.json"],
    ["PUT", "/api/v1/entries"],
    ["DELETE", "/api/v1/entries/sgv.json"],
    ["POST", "/api/v1/treatments"],
    ["POST", "/api/v1/treatments.json"],
    ["PUT", "/api/v1/treatments.json"],
    ["DELETE", "/api/v1/treatments.json"],
    ["PATCH", "/api/v1/treatments.json"],
    ["GET", "/api/v1/treatments"],
    ["GET", "/api/v1/entries/sgv.json/"],
    ["GET", "/api/v1/entries/../treatments"],
    ["GET", "/API/V1/VERIFYAUTH"],
  ])("refuses %s %s before sending anything", async (method, path) => {
    const seen: string[] = [];
    const recording = (input: string | URL) => {
      seen.push(String(input));
      return never();
    };
    await expect(
      sendNightscoutRequest(recording, { ...base, method, path }),
    ).rejects.toBeInstanceOf(ReadOnlyEndpointError);
    expect(seen).toEqual([]);
  });

  it("sends an allow-listed read without following redirects", async () => {
    let seen: { init?: { redirect?: string } | undefined } = {};
    await sendNightscoutRequest(
      (_input, init) => {
        seen = { init };
        return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve("[]") });
      },
      { ...base, ...ENDPOINTS.verifyauth },
    );
    expect(seen.init?.redirect).toBe("manual");
  });
});

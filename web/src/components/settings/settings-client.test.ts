import { describe, expect, it, vi } from "vitest";

import { ApiFailure, failureCode, settingsApi } from "./settings-client";

const SETTINGS = {
  aiEnabled: false,
  name: "Example space",
  timezone: "Europe/Copenhagen",
  glucoseUnit: "mgdl",
  targetLow: 4,
  targetHigh: 10,
  sourceType: null,
  sourceStatus: "not-configured",
  lastReadingAt: null,
};

function fetching(answer: Response | Error) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = vi.fn((url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  });
  return { api: settingsApi(fetchImpl as unknown as typeof fetch), calls };
}

describe("settingsApi (the screens' side of the Settings routes)", () => {
  it("PATCHes the space settings and parses the answer", async () => {
    const { api, calls } = fetching(Response.json(SETTINGS));
    expect(await api.patchSpace("s 1", { glucoseUnit: "mgdl" })).toEqual(SETTINGS);
    expect(calls[0]?.url).toBe("/api/spaces/s%201/settings");
    expect(calls[0]?.init.method).toBe("PATCH");
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({ glucoseUnit: "mgdl" });
  });

  it("sends one's own settings to /users/me and a member's to the owner route", async () => {
    const me = fetching(Response.json({ locale: "en", simpleMode: false, accent: "sea" }));
    await me.api.patchPerson("s1", "u1", true, { accent: "sea" });
    expect(me.calls[0]?.url).toBe("/api/users/me");
    const member = fetching(Response.json({ locale: "da", simpleMode: true, accent: "olive" }));
    await member.api.patchPerson("s1", "u2", false, { simpleMode: true });
    expect(member.calls[0]?.url).toBe("/api/spaces/s1/settings/members/u2");
  });

  it("POSTs the connect body to /source and parses the settings that come back", async () => {
    const { api, calls } = fetching(Response.json(SETTINGS));
    await api.connectSource("s1", {
      type: "dexcom-share",
      region: "eu",
      username: "example-user",
      password: "example-pass",
    });
    expect(calls[0]?.url).toBe("/api/spaces/s1/source");
    expect(calls[0]?.init.method).toBe("POST");
  });

  it("throws an ApiFailure with the body's code on a refusal, internal when there is no code, and internal on a network error", async () => {
    const refused = fetching(
      Response.json({ error: { code: "source-bad-credentials", message: "x" } }, { status: 400 }),
    );
    await expect(refused.api.patchSpace("s1", { glucoseUnit: "mgdl" })).rejects.toMatchObject({
      name: "ApiFailure",
      code: "source-bad-credentials",
      status: 400,
    });
    const html = fetching(new Response("<html>", { status: 502 }));
    await expect(html.api.patchMe({ accent: "plum" })).rejects.toMatchObject({ code: "internal" });
    const down = fetching(new Error("offline"));
    await expect(down.api.patchMe({ accent: "plum" })).rejects.toMatchObject({
      code: "internal",
      status: 0,
    });
    const odd = fetching(Response.json({ nonsense: true }));
    await expect(odd.api.patchMe({ accent: "plum" })).rejects.toMatchObject({ code: "internal" });
  });

  it("failureCode reads the code off an ApiFailure and is internal for anything else", () => {
    expect(failureCode(new ApiFailure("forbidden", 403))).toBe("forbidden");
    expect(failureCode(new Error("x"))).toBe("internal");
    expect(failureCode(undefined)).toBe("internal");
  });
});

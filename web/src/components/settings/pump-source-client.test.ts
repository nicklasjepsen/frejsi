// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { PumpSourceBody, pumpSourceApi } from "./pump-source-client";
import { ApiFailure } from "./settings-client";

const fetching = (answer: Response | Error) => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = vi.fn((url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  });
  return { api: pumpSourceApi(fetchImpl as unknown as typeof fetch), calls };
};

const BODY = { type: "nightscout" as const, url: "https://nightscout.example.test", token: "t-1" };

describe("pumpSourceApi (the card → /api/spaces/:id/pump-source)", () => {
  it("reads the view with a GET and no body", async () => {
    const { api, calls } = fetching(Response.json({ status: "not-configured", configured: false }));
    expect(await api.get("s 1")).toEqual({ status: "not-configured", configured: false });
    expect(calls[0]?.url).toBe("/api/spaces/s%201/pump-source");
    expect(calls[0]?.init.method).toBe("GET");
    expect(calls[0]?.init.body).toBeUndefined();
  });

  it("posts the form body as JSON and keeps recentBoluses from the answer", async () => {
    const { api, calls } = fetching(
      Response.json({ status: "connected", configured: true, recentBoluses: 0 }),
    );
    expect(await api.connect("s1", BODY)).toEqual({
      status: "connected",
      configured: true,
      recentBoluses: 0,
    });
    expect(calls[0]?.init.method).toBe("POST");
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual(BODY);
  });

  it("disconnects with a DELETE", async () => {
    const { api, calls } = fetching(Response.json({ status: "not-configured", configured: false }));
    await api.disconnect("s1");
    expect(calls[0]?.init.method).toBe("DELETE");
  });

  it("turns an ApiError into an ApiFailure with its code, and anything else into internal", async () => {
    const refused = fetching(
      Response.json(
        { error: { code: "source-url-invalid", message: "bad address" } },
        { status: 400 },
      ),
    );
    await expect(refused.api.connect("s1", BODY)).rejects.toEqual(
      new ApiFailure("source-url-invalid", 400),
    );
    await expect(fetching(new Error("offline")).api.get("s1")).rejects.toMatchObject({
      code: "internal",
      status: 0,
    });
    await expect(fetching(Response.json({ odd: true })).api.get("s1")).rejects.toMatchObject({
      code: "internal",
    });
  });
});

describe("PumpSourceBody", () => {
  it("is the Nightscout form only: no spaceId, no purpose, a bounded address", () => {
    expect(PumpSourceBody.safeParse(BODY).success).toBe(true);
    expect(PumpSourceBody.safeParse({ ...BODY, spaceId: "s2" }).success).toBe(false);
    expect(PumpSourceBody.safeParse({ ...BODY, purpose: "pump" }).success).toBe(false);
    expect(PumpSourceBody.safeParse({ ...BODY, url: "x".repeat(2049) }).success).toBe(false);
  });
});

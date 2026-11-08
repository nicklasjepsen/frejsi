import { afterEach, describe, expect, it } from "vitest";

import { GET } from "./route";

describe("GET /.well-known/webauthn", () => {
  afterEach(() => {
    delete process.env.APP_ORIGIN;
    delete process.env.APP_OTHER_ORIGINS;
  });

  it("lists every origin the app answers on, the main one first", async () => {
    process.env.APP_ORIGIN = "https://naensom.example";
    process.env.APP_OTHER_ORIGINS = "https://old.example, https://naensom.example";
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({
      origins: ["https://naensom.example", "https://old.example"],
    });
  });

  it("lists APP_ORIGIN alone when there are no other origins", async () => {
    process.env.APP_ORIGIN = "https://naensom.example";
    expect(await GET().json()).toEqual({ origins: ["https://naensom.example"] });
  });
});

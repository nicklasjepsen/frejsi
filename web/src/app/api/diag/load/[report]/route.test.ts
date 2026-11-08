import { describe, expect, it } from "vitest";

import { loadTimingQuery, loadTimingUrl } from "@/lib/diag/load-timing";

import { GET } from "./route";

const call = (report: string) =>
  GET(new Request(`https://naensom.example/api/diag/load/${report}`), {
    params: Promise.resolve({ report }),
  });

describe("GET /api/diag/load/:report", () => {
  it("takes the fields in the path and answers 204, never cached", async () => {
    const url = loadTimingUrl(loadTimingQuery(undefined, { v: "v0.7.6", os: "ios", at: 61000 }));
    expect(url).toBe("/api/diag/load/v:v0.7.6,os:ios,at:61000");
    const response = await call(url.slice("/api/diag/load/".length));
    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("refuses anything but fixed words and numbers", async () => {
    expect((await call("name:Example%20Person")).status).toBe(400);
    expect((await call(encodeURIComponent("<script>"))).status).toBe(400);
  });
});

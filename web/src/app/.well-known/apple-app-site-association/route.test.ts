// @vitest-environment node
import { describe, expect, it } from "vitest";

import { GET, dynamic } from "./route";

describe("GET /.well-known/apple-app-site-association", () => {
  it("answers 200 with application/json naming the app for /follow", async () => {
    expect(dynamic).toBe("force-static");
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.json()).toEqual({
      applinks: {
        details: [
          { appIDs: ["B32HGH682W.ninja.jepsen.naensom"], components: [{ "/": "/follow*" }] },
        ],
      },
    });
  });
});

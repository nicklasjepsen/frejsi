import { describe, expect, it } from "vitest";

import { GET } from "./route";

describe("GET /api/diag/load", () => {
  it("answers 204 and is never cached: the request itself is the report", () => {
    const response = GET();
    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

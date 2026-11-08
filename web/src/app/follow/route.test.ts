// @vitest-environment node
import { describe, expect, it } from "vitest";

import { CONTENT_SECURITY_POLICY } from "@/lib/ios-pages/pages";

import { GET, dynamic } from "./route";

describe("GET /follow", () => {
  it("is a static HTML page with both languages and a policy that forbids scripts", async () => {
    expect(dynamic).toBe("force-static");
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("content-security-policy")).toBe(CONTENT_SECURITY_POLICY);
    expect(res.headers.get("set-cookie")).toBeNull();
    const html = await res.text();
    expect(html).toContain("App Store");
    expect(html).not.toMatch(/<script/i);
  });
});

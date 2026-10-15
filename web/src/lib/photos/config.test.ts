import { describe, expect, it } from "vitest";
import nextConfig from "../../../next.config";

describe("photo native dependency tracing", () => {
  it("keeps sharp external and traces its hoisted native packages into standalone output", () => {
    expect(nextConfig.output).toBe("standalone");
    expect(nextConfig.serverExternalPackages).toContain("sharp");
    expect(nextConfig.outputFileTracingIncludes?.["/*"]).toEqual(
      expect.arrayContaining(["../node_modules/sharp/**/*", "../node_modules/@img/**/*"]),
    );
  });
});

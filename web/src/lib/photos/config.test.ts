import { describe, expect, it } from "vitest";
import nextConfig from "../../../next.config";

describe("photo native dependency tracing", () => {
  it("keeps sharp external and traces its pnpm native packages into standalone output", () => {
    expect(nextConfig.output).toBe("standalone");
    expect(nextConfig.serverExternalPackages).toContain("sharp");
    expect(nextConfig.outputFileTracingIncludes?.["/*"]).toEqual(
      expect.arrayContaining([
        "../node_modules/.pnpm/sharp@*/node_modules/sharp/**/*",
        "../node_modules/.pnpm/@img+sharp-*/node_modules/@img/**/*",
      ]),
    );
  });
});

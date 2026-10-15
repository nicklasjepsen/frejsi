import { defineConfig } from "vitest/config";

// Root runs and IDEs use each package's unit-test config. CI runs them via `pnpm -r test`.
export default defineConfig({
  test: {
    projects: ["shared/vitest.config.ts", "web/vitest.config.ts", "poller/vitest.config.js"],
  },
});

import { defineConfig } from "vitest/config";

// Unit tests only: no database, no Azure, no .env. Prisma integration tests live under
// test/integration/ and run in release.yml through their own script.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["test/integration/**", "**/node_modules/**"],
    environment: "node",
  },
});

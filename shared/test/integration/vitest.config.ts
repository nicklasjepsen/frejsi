import path from "node:path";

import { defineConfig } from "vitest/config";

// Prisma integration tests against a real SQL Server (`DATABASE_URL`), release.yml only (plan §8).
// Each run works in a database of its own, created empty and dropped afterwards, so it never
// touches the data behind `DATABASE_URL` itself. `@` resolves as in web/, for the one test that
// runs the web app's viewer query against the database.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "../../../web/src") },
  },
  test: {
    include: ["test/integration/**/*.test.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});

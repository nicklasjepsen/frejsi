import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["src/run.eval.ts"], environment: "node", testTimeout: 190_000 },
});

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
const root = path.resolve(import.meta.dirname, "../../..");
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? files(path.join(dir, e.name))
      : /\.tsx?$/.test(e.name)
        ? [path.join(dir, e.name)]
        : [],
  );
}
const write =
  /\.\s*insight\s*\.\s*(?:create|createMany|upsert|update|updateMany|delete|deleteMany)\s*\(/;
it("keeps Insight database writes in store.ts across all three packages", () => {
  expect(write.test("prisma.insight.create({});")).toBe(true);
  const production = ["shared", "web", "poller"]
    .flatMap((pkg) => files(path.join(root, pkg, "src")))
    .filter((f) => !/\.test\.tsx?$/.test(f));
  const writers = production
    .filter((file) => write.test(readFileSync(file, "utf8")))
    .map((file) => path.relative(root, file));
  expect(writers).toEqual(["shared/src/insights/store.ts"]);
});

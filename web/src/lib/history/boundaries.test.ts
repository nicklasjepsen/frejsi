// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
const root = path.resolve(import.meta.dirname, "../../../..");
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(path.join(dir, entry.name))
      : /\.tsx?$/.test(entry.name)
        ? [path.join(dir, entry.name)]
        : [],
  );
}
function violations(file: string, code: string): string[] {
  if (/\.test\.tsx?$/.test(file)) return [];
  const found: string[] = [];
  if (file.includes("/lib/history/")) {
    if (
      /\b(?:emit|createEmit)\b|\.\s*(?:create|createMany|update|updateMany|delete|deleteMany|upsert)\s*\(/.test(
        code,
      )
    )
      found.push("write");
    if (
      !file.endsWith("/prisma.ts") &&
      /\b(?:prisma|PrismaClient)\b/.test(
        code.replace(
          /import\s*\{\s*PrismaHistoryRepository\s*\}\s*from\s*["']\.\/prisma["'];?/,
          "",
        ),
      )
    )
      found.push("database");
  }
  if (
    /from\s*["'][^"']*(?:history\/memory|\.\/memory)["']/.test(code) &&
    (file.includes("/lib/history/") || code.includes("history/memory"))
  )
    found.push("test fake");
  return found;
}
it("enforces read-only history, the Prisma boundary and a tests-only memory fake", () => {
  expect(
    violations(
      "/lib/history/bad.ts",
      "db.reading.create({}); emit(); import { prisma } from '@frejsi/shared';",
    ),
  ).toEqual(["write", "database"]);
  expect(
    violations("/app/page.ts", "import { MemoryHistoryRepository } from '@/lib/history/memory';"),
  ).toEqual(["test fake"]);
  expect(
    files(path.join(root, "web/src")).flatMap((file) =>
      violations(file, readFileSync(file, "utf8")).map((v) => `${file}: ${v}`),
    ),
  ).toEqual([]);
});

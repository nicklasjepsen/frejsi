import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// Every write from the log screen goes through the foods and meals routes, so every write emits
// (plan §7, decision 34). Nothing under log/, components/meal/ or lib/barcode/ reaches the database.
const roots = [
  import.meta.dirname,
  path.resolve(import.meta.dirname, "../../../../components/meal"),
  path.resolve(import.meta.dirname, "../../../../lib/barcode"),
];

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.tsx?$/.test(entry.name) &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".test.tsx")
      ? [full]
      : [];
  });
}

describe("log screen boundaries", () => {
  const files = roots.flatMap(sources);

  it("reads the files it guards", () => {
    expect(files.map((f) => path.basename(f))).toEqual(
      expect.arrayContaining(["controller.ts", "api.ts", "detect.ts"]),
    );
  });

  it.each(
    files.map((f) => [path.relative(path.resolve(import.meta.dirname, "../../../.."), f), f]),
  )("%s imports no Prisma, no server module and not the @frejsi/shared barrel", (_name, file) => {
    const text = readFileSync(file, "utf8");
    expect(text).not.toMatch(/@prisma\/client|\bprisma\b\./);
    expect(text).not.toMatch(/from "@frejsi\/shared"/);
    expect(text).not.toMatch(/@\/lib\/(auth|live\/server|foods|meals)/);
  });
});

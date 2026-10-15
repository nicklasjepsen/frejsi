import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const here = import.meta.dirname;
const pages = path.resolve(here, "../../app/[locale]/(app)/library");

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe("Bibliotek boundaries (plan task 5 hard rules)", () => {
  const files = [...sources(here), ...sources(pages)].filter(
    (file) => !file.endsWith("test-support.ts"),
  );

  it("writes only through the foods routes: no Prisma, no lib/foods service, no emit in the screens", () => {
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/@prisma\/client|from "@frejsi\/shared"|lib\/foods|\bemit\(/);
    }
  });

  it("colours the screens from the tokens only, so dark mode and every accent follow", () => {
    const css = readFileSync(path.join(here, "library.module.css"), "utf8");
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  });
});

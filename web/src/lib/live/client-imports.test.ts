// The browser bundle must never follow the @frejsi/shared barrel: it exports Prisma and App
// Insights, which no client bundle can resolve (`next build` fails on `fs`, `net`, `async_hooks`).
// Client-side modules of this lane import the schemas and units by their browser-safe subpaths.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const web = path.resolve(import.meta.dirname, "../../..");

/** Every non-test module under the given folders, except the ones named server-only. */
function clientModules(folders: string[], serverOnly: string[]): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) files.push(full);
    }
  };
  for (const folder of folders) walk(path.join(web, folder));
  return files.filter((f) => !serverOnly.some((s) => f.endsWith(s)));
}

const RUNTIME_BARREL_IMPORT = /^import\s+(?!type\s)[^;]*?from\s+"@frejsi\/shared";/m;

describe("client modules and the shared barrel", () => {
  it("import runtime values only from browser-safe subpaths of @frejsi/shared", () => {
    const files = clientModules(
      ["src/lib/live", "src/components/glucose", "src/app/[locale]/(app)/now"],
      [
        "lib/live/server.ts",
        "lib/live/upstream.ts",
        "lib/live/test-support.ts",
        "(app)/now/page.tsx",
      ],
    );
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source, path.relative(web, file)).not.toMatch(RUNTIME_BARREL_IMPORT);
    }
  });

  it("names the subpaths the barrel-free modules rely on, so the shared layout cannot move them silently", () => {
    const shared = path.resolve(web, "../shared/src");
    for (const subpath of ["schemas/index.ts", "glucose/units.ts"]) {
      expect(statSync(path.join(shared, subpath)).isFile(), subpath).toBe(true);
    }
  });
});

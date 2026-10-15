import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const pollerDir = path.resolve(import.meta.dirname, "..");
const pkg = JSON.parse(readFileSync(path.join(pollerDir, "package.json"), "utf8")) as {
  main: string;
  scripts: { build: string };
  dependencies: Record<string, string>;
};

interface BuildConfig {
  EXTERNALS: string[];
  PROVIDED_AT_RUNTIME: string[];
  ENTRY_POINTS: string[];
  distDependencies(pkg: unknown): Record<string, string>;
}

// A variable path keeps TypeScript from typing the untyped build script.
const configPath = path.join(pollerDir, "esbuild.config.mjs");
const config = (await import(/* @vite-ignore */ configPath)) as BuildConfig;

const externals = config.EXTERNALS.filter((name) => !config.PROVIDED_AT_RUNTIME.includes(name));

describe("poller build", () => {
  it("is the esbuild script, so dist/ is assembled the same way everywhere", () => {
    expect(pkg.scripts.build).toBe("node esbuild.config.mjs");
  });

  it("bundles one entry that registers every function, so they share one copy of shared", () => {
    expect(config.ENTRY_POINTS).toEqual(["src/index.ts"]);
    const entry = readFileSync(path.join(pollerDir, "src/index.ts"), "utf8");
    expect(entry).toContain('import "./functions/poll"');
    expect(entry).toContain('import "./functions/source-connect"');
    // The glob package.json#main names still matches the single bundle.
    expect(pkg.main).toBe("dist/{index,functions/*}.js");
  });

  it("names at least one external the bundle leaves to node_modules", () => {
    expect(externals.length).toBeGreaterThan(0);
  });

  it("declares every external as a runtime dependency so dist/ can resolve it on the Function App", () => {
    for (const name of externals) {
      expect(pkg.dependencies, `${name} is external but not in dependencies`).toHaveProperty(name);
    }
    expect(config.distDependencies(pkg)).toEqual(
      Object.fromEntries(externals.map((name) => [name, pkg.dependencies[name]])),
    );
  });

  it("refuses to build when an external is not a dependency", () => {
    expect(() => config.distDependencies({ dependencies: {} })).toThrow(/not a dependency/);
  });

  // Only a built dist/ can show it stands alone; without one there is nothing to check, and
  // walking up to poller/node_modules would pass for the wrong reason.
  const dist = path.join(pollerDir, "dist");
  it.skipIf(!existsSync(dist))(
    "installs every external inside dist/node_modules, where dist/index.js will run",
    () => {
      // Node's lookup, by hand and stopped at dist/: `pnpm run` puts the hidden .pnpm/node_modules on
      // NODE_PATH, which would make require.resolve pass here and fail on the Function App.
      for (const name of externals) {
        expect(
          existsSync(path.join(dist, "node_modules", name, "package.json")),
          `${name} is not installed in poller/dist/node_modules`,
        ).toBe(true);
      }
    },
  );
});

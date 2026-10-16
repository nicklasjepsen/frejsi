import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../../../..");
function files(directory: string): string[] {
  if (!existsSync(path.join(root, directory))) return [];
  return readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const file = `${directory}/${entry.name}`;
    return entry.isDirectory() ? files(file) : /\.[cm]?tsx?$/.test(file) ? [file] : [];
  });
}
const isTest = (file: string) => /\.test\.tsx?$/.test(file);
const fakeAllowed = (file: string) =>
  isTest(file) || /(^|\/)(seed|cli)\.ts$/.test(file) || file === "shared/src/food/registry.ts";

const endpoint = ["product", "jqm2"].join("_");
const host = ["openfoodfacts", "org"].join(".");

function violations(file: string, code: string): string[] {
  const found: string[] = [];
  const inOff = file.startsWith("shared/src/food/off/");
  if (!inOff && code.includes(endpoint)) found.push("OFF write endpoint outside adapter");
  if (!inOff && code.includes(`world.${host}`)) found.push("OFF default host outside adapter");
  if (
    !fakeAllowed(file) &&
    file !== "shared/src/food/fake-contributor.ts" &&
    /\bFakeFoodContributor\b|fake-contributor/.test(code)
  )
    found.push("FakeFoodContributor outside tests, seed, cli and registry");
  if (
    !isTest(file) &&
    file !== "shared/src/food/registry.ts" &&
    /\b(OffContributor|off\/contribute)\b/.test(code) &&
    !inOff
  )
    found.push("OffContributor outside registry");
  if (inOff && file.endsWith("contribute.ts") && code.includes("globalThis.fetch"))
    found.push("real fetch inside the contributor");
  if (
    /^shared\/src\/food\/(off\/contribute|fake-contributor)\.ts$/.test(file) &&
    /@prisma|\/db\/|repository/i.test(code.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""))
  )
    found.push("contributor reaches a Prisma client or repository");
  if (!isTest(file) && file.startsWith("shared/") && code.includes(".contribute("))
    found.push("contribute() called in production shared code");
  return found;
}

it("detects each violation and allows the sanctioned places", () => {
  expect(violations("web/src/x.ts", `post("/cgi/${endpoint}.pl")`)).toHaveLength(1);
  expect(violations("shared/src/food/off/contribute.ts", `"/cgi/${endpoint}.pl"`)).toEqual([]);
  expect(violations("web/src/x.ts", `import { FakeFoodContributor } from "x"`)).toHaveLength(1);
  for (const ok of ["web/src/a.test.ts", "web/scripts/seed.ts", "poller/src/cli.ts"])
    expect(violations(ok, `new FakeFoodContributor()`), ok).toEqual([]);
  expect(violations("shared/src/food/registry.ts", `new FakeFoodContributor()`)).toEqual([]);
  expect(
    violations("web/src/x.ts", `new OffContributor({ fetch: globalThis.fetch })`),
  ).toHaveLength(1);
  expect(violations("shared/src/food/registry.ts", `new OffContributor({})`)).toEqual([]);
  expect(violations("shared/src/food/off/contribute.ts", `fetch: globalThis.fetch`)).toHaveLength(
    1,
  );
  expect(
    violations("shared/src/food/off/contribute.ts", `import { prisma } from "../../db/client"`),
  ).toHaveLength(1);
  expect(
    violations(
      "shared/src/food/fake-contributor.ts",
      `import type { FoodRepository } from "./types"`,
    ),
  ).toHaveLength(1);
  expect(violations("shared/src/x.ts", `await contributor.contribute(c, s)`)).toHaveLength(1);
  expect(violations("shared/src/x.test.ts", `await contributor.contribute(c, s)`)).toEqual([]);
  expect(violations("web/src/lib/contributions/service.ts", `c.contribute(x, s)`)).toEqual([]);
});

it("registry.ts passes OFF_CONTRIBUTE_HOST through and is the only place the real fetch reaches the contributor", () => {
  const registry = readFileSync(path.join(root, "shared/src/food/registry.ts"), "utf8");
  expect(registry).toContain("OFF_CONTRIBUTE_HOST");
  expect(registry).toMatch(/new OffContributor\(\{[^}]*fetch: globalThis\.fetch/s);
  expect(registry).not.toContain(endpoint);
  expect(registry).not.toContain(host);
});

it("enforces the contribution boundaries on every production source in CI", () => {
  const found = ["shared/src", "shared/scripts", "web/src", "web/scripts", "poller/src"]
    .flatMap(files)
    .filter((file) => !file.endsWith("lint-boundaries.test.ts"))
    .flatMap((file) =>
      violations(file, readFileSync(path.join(root, file), "utf8")).map(
        (reason) => `${file}: ${reason}`,
      ),
    );
  expect(found).toEqual([]);
});

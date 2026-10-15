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
function violations(file: string, code: string): string[] {
  const found: string[] = [];
  if (!file.startsWith("shared/src/food/off/") && code.includes("openfoodfacts.org"))
    found.push("OFF host outside adapter");
  const dataset = ["frida", "json"].join(".");
  if (
    !file.startsWith("shared/src/food/frida/") &&
    file !== "shared/scripts/import-frida.ts" &&
    code.includes(dataset)
  )
    found.push("Frida dataset outside adapter");
  if (
    file.startsWith("shared/src/food/frida/") &&
    !file.endsWith(".test.ts") &&
    /\bfetch\b|node:https?\b|node:net\b|axios|undici|https?:\/\//.test(code)
  )
    found.push("Frida network access");
  return found;
}
it("detects vendor calls and dataset access outside the adapters and network access inside Frida", () => {
  expect(violations("web/src/food.ts", 'fetch("https://world.openfoodfacts.org")')).toHaveLength(1);
  expect(
    violations("shared/src/food/off/source.ts", 'fetch("https://world.openfoodfacts.org")'),
  ).toEqual([]);
  expect(
    violations(
      "shared/src/food/lookup.ts",
      `import data from "./frida/data/${["frida", "json"].join(".")}"`,
    ),
  ).toHaveLength(1);
  expect(
    violations("shared/src/food/frida/source.ts", 'fetch("https://example.invalid")'),
  ).toHaveLength(1);
  expect(
    violations("shared/src/food/frida/source.ts", 'import http from "node:http"'),
  ).toHaveLength(1);
});
it("enforces vendor and dataset boundaries on every production source in CI", () => {
  const found = ["shared/src", "shared/scripts", "web/src", "web/scripts", "poller/src"]
    .flatMap(files)
    .flatMap((file) =>
      violations(file, readFileSync(path.join(root, file), "utf8")).map(
        (reason) => `${file}: ${reason}`,
      ),
    );
  expect(found).toEqual([]);
});

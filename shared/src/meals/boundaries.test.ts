import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../../..");
const fakeFiles = ["shared/src/food/fake", "shared/src/food/memory"];

/** Resolve imports as well as re-exports so a barrel cannot leak a fake into production. */
function violations(file: string, code: string): string[] {
  if (/(?:\.test\.tsx?|\/(?:seed|cli)\.ts)$/.test(file)) return [];
  const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const check = (specifier: string) => {
    const resolved = specifier.startsWith(".")
      ? path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier))
      : specifier.replace(/^@frejsi\/shared\//, "shared/src/");
    if (fakeFiles.includes(resolved.replace(/\.(?:ts|js)$/, ""))) found.push(specifier);
  };
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      check(node.moduleSpecifier.text);
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteral(argument)) check(argument.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function files(directory: string): string[] {
  if (!existsSync(path.join(root, directory))) return [];
  return readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const file = `${directory}/${entry.name}`;
    return entry.isDirectory() ? files(file) : /\.tsx?$/.test(file) ? [file] : [];
  });
}

describe("food fake import boundaries", () => {
  it("rejects production imports, dynamic imports and barrel leaks while allowing tests, seed and CLI", () => {
    const code = 'import { FakeFoodSource } from "@frejsi/shared/food/fake";';
    expect(violations("web/src/lib/food.ts", code)).toHaveLength(1);
    expect(violations("web/src/lib/food.test.ts", code)).toEqual([]);
    expect(violations("web/scripts/seed.ts", code)).toEqual([]);
    expect(violations("poller/src/cli.ts", code)).toEqual([]);
    expect(violations("shared/src/index.ts", 'export * from "./food/memory";')).toHaveLength(1);
    expect(
      violations(
        "shared/src/food/lookup.ts",
        'import { MemoryFoodRepository } from "./memory.js";',
      ),
    ).toHaveLength(1);
    expect(
      violations("web/src/lib/food.ts", 'const fake = import("@frejsi/shared/food/fake");'),
    ).toHaveLength(1);
  });
  it("enforces the boundary across the actual production tree in CI", () => {
    const found = ["shared/src", "web/src", "poller/src", "web/scripts"]
      .flatMap(files)
      .flatMap((file) =>
        violations(file, readFileSync(path.join(root, file), "utf8")).map(
          (specifier) => `${file}: ${specifier}`,
        ),
      );
    expect(found).toEqual([]);
  });
});

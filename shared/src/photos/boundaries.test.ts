import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../../..");

/** AST check runs in the fast suite because the shared ESLint config is outside this lane. */
function violations(file: string, source: string): string[] {
  const imports: string[] = [];
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  function visit(node: ts.Node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      imports.push(node.moduleSpecifier.text);
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteral(argument)) imports.push(argument.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  const found: string[] = [];
  for (const specifier of imports) {
    if (/^@azure\/storage-blob(?:\/|$)/.test(specifier) && file !== "shared/src/photos/blob.ts")
      found.push("blob-adapter-only");
    if (/^sharp(?:\/|$)/.test(specifier) && file !== "shared/src/photos/process.ts")
      found.push("processor-only");
    const resolved = specifier.startsWith(".")
      ? path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier))
      : specifier;
    if (
      /(?:^|\/)photos\/memory(?:\.[jt]s)?$/.test(resolved) &&
      !/(?:\.test\.tsx?|\/(?:seed|cli)\.ts)$/.test(file)
    )
      found.push("test-fake-only");
    if (file === "shared/src/index.ts" && /(?:^|\/)photos(?:\/|$)/.test(resolved))
      found.push("no-root-photo-export");
  }
  return found;
}

function files(dir: string): string[] {
  return readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const name = `${dir}/${entry.name}`;
    return entry.isDirectory() ? files(name) : /\.[cm]?tsx?$/.test(name) ? [name] : [];
  });
}

describe("photo import boundaries", () => {
  it("refuses SDK, native processor and fake imports outside their permitted consumers", () => {
    expect(
      violations(
        "web/src/lib/other.ts",
        'import x from "@azure/storage-blob"; import y from "sharp"; import {MemoryPhotoStore} from "@frejsi/shared/photos/memory";',
      ),
    ).toEqual(["blob-adapter-only", "processor-only", "test-fake-only"]);
    expect(violations("shared/src/index.ts", 'export * from "./photos/index";')).toEqual([
      "no-root-photo-export",
    ]);
    expect(violations("shared/src/photos/index.ts", 'export * from "./memory";')).toEqual([
      "test-fake-only",
    ]);
    expect(violations("shared/src/other.ts", 'const x = import("sharp");')).toEqual([
      "processor-only",
    ]);
    expect(violations("shared/src/photos/blob.ts", 'import x from "@azure/storage-blob";')).toEqual(
      [],
    );
    expect(violations("shared/src/photos/process.ts", 'import x from "sharp";')).toEqual([]);
    for (const file of [
      "web/scripts/seed.ts",
      "poller/src/cli.ts",
      "shared/src/photos/keys.test.ts",
      "web/src/lib/food.test.tsx",
    ]) {
      expect(
        violations(file, 'import {MemoryPhotoStore} from "@frejsi/shared/photos/memory";'),
      ).toEqual([]);
    }
  });
  it("enforces the boundaries across shared, web and poller sources", () => {
    const found = ["shared/src", "web/src", "poller/src"]
      .flatMap(files)
      .flatMap((file) =>
        violations(file, readFileSync(path.join(root, file), "utf8")).map(
          (code) => `${file}: ${code}`,
        ),
      );
    expect(found).toEqual([]);
  });
});

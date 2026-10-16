import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

function violations(file: string, source: string): string[] {
  const result: string[] = [];
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const check = (specifier: string) => {
    const resolved = specifier.startsWith(".")
      ? path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier))
      : specifier;
    if (
      /(?:^|\/)web(?:\/|$)|(?:^|\/)glucose(?:\/|$)|insights\/week-input|lib\/history/.test(resolved)
    )
      result.push(specifier);
  };
  function visit(node: ts.Node) {
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
      const first = node.arguments[0];
      if (first && ts.isStringLiteral(first)) check(first.text);
    }
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    )
      check(node.argument.literal.text);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return result;
}
it("blocks raw-reading and web imports including aliases, exports, dynamic and type imports", () => {
  for (const source of [
    'import { Reading as R } from "@frejsi/shared/glucose/types";',
    'export * from "../../shared/src/glucose/index";',
    'const x = import("../../web/src/lib/history/service");',
    'type X = import("@frejsi/shared/insights/week-input").X;',
  ])
    expect(violations("evals/src/example.ts", source)).toHaveLength(1);
  expect(
    violations("evals/src/example.ts", 'import { InsightInput } from "@frejsi/shared/schemas/ai";'),
  ).toEqual([]);
});
it("keeps all eval source files on aggregate-only shared interfaces", () => {
  const dir = import.meta.dirname;
  const files = readdirSync(dir).filter((file) => file.endsWith(".ts"));
  expect(files.length).toBeGreaterThan(5);
  for (const file of files)
    expect(
      violations(`evals/src/${file}`, readFileSync(path.join(dir, file), "utf8")),
      file,
    ).toEqual([]);
});

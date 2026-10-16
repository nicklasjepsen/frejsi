// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
const root = path.resolve(import.meta.dirname, "../../../..");
const writers = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
  "delete",
  "deleteMany",
]);
function violations(file: string, code: string): string[] {
  if (file === "web/src/lib/readings/service.ts" || /\.test\.tsx?$/.test(file)) return [];
  const found: string[] = [];
  const tree = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const access = node.expression;
      if (
        writers.has(access.name.text) &&
        ts.isPropertyAccessExpression(access.expression) &&
        ["reading"].includes(access.expression.name.text)
      )
        found.push(access.getText(tree));
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return found;
}
function files(dir: string): string[] {
  return readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const name = `${dir}/${entry.name}`;
    return entry.isDirectory() ? files(name) : /\.tsx?$/.test(name) ? [name] : [];
  });
}
describe("reading write boundary", () => {
  it("rejects reading writes outside addManualReading and checks the actual production tree", () => {
    const code = "db.reading.create({}); tx.reading.deleteMany({});";
    expect(violations("web/src/app/api/route.ts", code)).toHaveLength(2);
    expect(violations("web/src/lib/readings/service.ts", code)).toEqual([]);
    expect(violations("web/src/lib/readings/repository.ts", code)).toHaveLength(2);
    expect(violations("web/scripts/seed.ts", code)).toHaveLength(2);
    expect(
      ["web/src", "web/scripts"]
        .flatMap(files)
        .flatMap((file) =>
          violations(file, readFileSync(path.join(root, file), "utf8")).map(
            (match) => `${file}: ${match}`,
          ),
        ),
    ).toEqual([]);
  });
});

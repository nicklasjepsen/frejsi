import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../../../..");
const writes = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "upsert",
  "delete",
  "deleteMany",
]);
function violations(file: string, text: string): string[] {
  if (
    /\.test\.tsx?$/.test(file) ||
    file.startsWith("web/src/lib/foods/") ||
    file === "shared/src/food/repository.ts"
  )
    return [];
  const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const member = node.expression;
      if (
        writes.has(member.name.text) &&
        ts.isPropertyAccessExpression(member.expression) &&
        member.expression.name.text === "food"
      )
        found.push(member.getText(tree));
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return found;
}
function files(dir: string): string[] {
  if (!existsSync(path.join(root, dir))) return [];
  return readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const file = `${dir}/${entry.name}`;
    return entry.isDirectory() ? files(file) : /\.tsx?$/.test(file) ? [file] : [];
  });
}
describe("food write boundary", () => {
  it("rejects food writes from routes and seeds, allowing only services and the cache repository", () => {
    const probe = "await prisma.food.create({data: {}}); await tx.food.update({});";
    expect(violations("web/src/app/api/spaces/example/foods/route.ts", probe)).toHaveLength(2);
    expect(violations("web/scripts/seed.ts", probe)).toHaveLength(2);
    expect(violations("web/src/lib/foods/index.ts", probe)).toEqual([]);
    expect(violations("shared/src/food/repository.ts", probe)).toEqual([]);
  });
  it("enforces the boundary on the production tree in CI", () => {
    const scanned = ["web/src", "web/scripts", "shared/src", "poller/src"].flatMap(files);
    expect(scanned).toContain("web/src/lib/foods/index.ts");
    expect(
      scanned.flatMap((file) =>
        violations(file, readFileSync(path.join(root, file), "utf8")).map(
          (hit) => `${file}: ${hit}`,
        ),
      ),
    ).toEqual([]);
  });
});

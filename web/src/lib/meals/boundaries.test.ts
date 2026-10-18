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
// The only writers of meal and mealItem. The pump cycle's store makes pump meals, sets and clears
// their links, and removes an untouched pump meal a person's meal replaced; plan §6 puts those
// writes in shared/src/pump/store.ts, in the cycle's own Serializable transaction (#224).
const PUMP_STORE = "shared/src/pump/store.ts";
const allowed = (file: string) => file.startsWith("web/src/lib/meals/") || file === PUMP_STORE;
function violations(file: string, code: string): string[] {
  if (allowed(file) || /\.test\.tsx?$/.test(file)) return [];
  const found: string[] = [];
  const tree = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const access = node.expression;
      if (
        writers.has(access.name.text) &&
        ts.isPropertyAccessExpression(access.expression) &&
        ["meal", "mealItem"].includes(access.expression.name.text)
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
describe("meal write boundary", () => {
  it("rejects meal and item writes outside the services and checks the actual production tree", () => {
    const code = "db.meal.create({}); tx.mealItem.deleteMany({});";
    expect(violations("web/src/app/api/route.ts", code)).toHaveLength(2);
    expect(violations("web/src/lib/meals/repository.ts", code)).toEqual([]);
    expect(violations("web/scripts/seed.ts", code)).toHaveLength(2);
    expect(violations(PUMP_STORE, code)).toEqual([]);
    expect(
      ["web/src", "web/scripts", "shared/src", "poller/src"]
        .flatMap(files)
        .flatMap((file) =>
          violations(file, readFileSync(path.join(root, file), "utf8")).map(
            (match) => `${file}: ${match}`,
          ),
        ),
    ).toEqual([]);
  });
  it("lets only the pump store through: another shared file, or a lookalike path, is still refused", () => {
    const code = "tx.meal.create({}); tx.meal.updateMany({}); tx.mealItem.deleteMany({});";
    expect(violations("shared/src/pump/poll-cycle.ts", code)).toHaveLength(3);
    expect(violations("shared/src/pump/store-extra.ts", code)).toHaveLength(3);
    expect(violations("poller/src/shared/src/pump/store.ts", code)).toHaveLength(3);
  });
});

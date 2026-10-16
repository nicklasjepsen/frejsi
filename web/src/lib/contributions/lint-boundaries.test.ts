import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../../../..");
const service = "web/src/lib/contributions/index.ts";

/** Every `.contribute(` call in a file. */
function callers(file: string, text: string): string[] {
  if (/\.test\.tsx?$/.test(file)) return [];
  const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "contribute"
    )
      found.push(node.expression.getText(tree));
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
describe("contribution boundary", () => {
  it("detects a .contribute( call", () => {
    expect(callers("web/src/x.ts", "await c.contribute(a, signal);")).toHaveLength(1);
    expect(callers("web/src/x.test.ts", "await c.contribute(a, signal);")).toEqual([]);
  });
  it("lets only contributeFood call a contributor, in web, shared and the poller", () => {
    const scanned = ["web/src", "web/scripts", "poller/src", "shared/src"].flatMap(files);
    expect(scanned).toContain(service);
    const hits = scanned.flatMap((file) =>
      callers(file, readFileSync(path.join(root, file), "utf8")).map((hit) => `${file}: ${hit}`),
    );
    expect(hits).toEqual([`${service}: contributor.contribute`]);
  });
});

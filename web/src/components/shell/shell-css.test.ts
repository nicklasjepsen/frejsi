import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

const css = readFileSync(path.join(import.meta.dirname, "shell.module.css"), "utf8");
const block = (selector: string): string => {
  const start = css.indexOf(selector);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  return css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
};

it("lets the header's status shrink before the space name, which keeps a readable minimum", () => {
  // The name grows into the free space from a zero basis, so only the status (auto basis) gives
  // way when the row is too narrow; the name never goes below its minimum.
  const name = block(".phoneHeaderName,\n.phoneSwitcher {");
  expect(name).toMatch(/flex: 1 1 0;/);
  expect(name).toMatch(/min-width: 140px;/);
  const end = block(".headerEnd {");
  expect(end).toMatch(/flex: 0 1 auto;/);
  expect(end).toMatch(/min-width: 0;/);
});

it("keeps hover effects off touch screens, where a tap would leave them stuck", () => {
  const hover = css.slice(css.indexOf("@media (hover: hover)"));
  expect(hover.length).toBeGreaterThan(0);
  for (const rule of [".tab:hover", ".sidebarItem:hover", ".switcherOption:hover"]) {
    expect(hover).toContain(rule);
  }
  expect(css.slice(0, css.indexOf("@media (hover: hover)"))).not.toContain(":hover");
});

import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

const read = (file: string) => readFileSync(path.resolve(import.meta.dirname, file), "utf8");
const css = read("library.module.css");
const tokens = read("../../styles/tokens.css");
const block = (source: string, selector: string) => {
  const start = source.indexOf(selector);
  expect(start).toBeGreaterThanOrEqual(0);
  return source.slice(source.indexOf("{", start) + 1, source.indexOf("}", start));
};
const variables = (source: string): Record<string, string> =>
  Object.fromEntries(
    [...source.matchAll(/(--[a-z-]+):\s*([^;]+);/g)].map((match) => [
      match[1] ?? "",
      (match[2] ?? "").trim(),
    ]),
  );

// The checkbox row ("Send rettelsen …") reuses `.toggle` and the status line `.muted` / `.problem`.
it("renders the checkbox row and its status line from tokens in light, dark and the five accents", () => {
  const rows = [".toggle {", ".toggle input {", ".muted {", ".problem {"].map((s) => block(css, s));
  const names = rows.flatMap((r) => [...r.matchAll(/var\((--[a-z-]+)\)/g)].map((m) => m[1] ?? ""));
  const used = [...new Set(names)].sort();
  expect(used.length).toBeGreaterThan(0);
  expect(rows.join("")).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  const schemes = {
    light: tokens.slice(0, tokens.indexOf("@media (prefers-color-scheme: dark)")),
    dark: tokens.slice(tokens.indexOf("@media (prefers-color-scheme: dark)")),
  };
  for (const [scheme, source] of Object.entries(schemes)) {
    for (const accent of ["olive", "plum", "sea", "forest", "garnet"]) {
      const values = {
        ...variables(block(tokens, ":root")),
        ...variables(block(source, ":root")),
        ...variables(block(source, `[data-accent="${accent}"]`)),
      };
      for (const name of used) expect(values[name], `${scheme} ${accent} ${name}`).toBeDefined();
      expect(Object.fromEntries(used.map((name) => [name, values[name]]))).toMatchSnapshot(
        `${scheme} ${accent}`,
      );
    }
  }
});

it("keeps the row at one size for the phone (360) and the desktop panel (1280)", () => {
  const row = block(css, ".toggle {");
  expect(row).toContain("min-height: 44px");
  // No media query hides or resizes the row at either width.
  for (const start of [...css.matchAll(/@media[^{]*\{/g)].map((m) => m.index)) {
    let depth = 0;
    let end = start;
    for (; end < css.length; end++) {
      if (css[end] === "{") depth++;
      if (css[end] === "}" && --depth === 0) break;
    }
    expect(css.slice(start, end)).not.toMatch(/\.toggle\b/);
  }
});

import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

const read = (file: string) => readFileSync(path.resolve(import.meta.dirname, file), "utf8");
const css = read("history-week.module.css");
const chartCss = read("../glucose/glucose.module.css");
const statsCss = read("../stats/stats.module.css");
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
it("uses inherited theme variables for the week, phone, and meals views at 360 and 1280", () => {
  const used = [
    ...new Set(
      [...(css + chartCss + statsCss).matchAll(/var\((--[a-z-]+)\)/g)].map(
        (match) => match[1] ?? "",
      ),
    ),
  ].sort();
  expect(used).toMatchSnapshot("variables used by the week, chart and stat tiles");
  expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
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
      const resolved = Object.fromEntries(used.map((name) => [name, values[name]]));
      for (const name of used) expect(values[name], `${scheme} ${accent} ${name}`).toBeDefined();
      expect(resolved).toMatchSnapshot(`${scheme} ${accent}`);
    }
  }
  expect(block(css, ".days {")).toContain("grid-template-columns: minmax(0, 1fr)");
  expect(block(css.slice(css.indexOf("@media (min-width: 1280px)")), ".days {")).toContain(
    "repeat(7, minmax(0, 1fr))",
  );
  expect(block(css, ".arrows a,")).toMatch(/width: 44px;\s*height: 44px/);
  expect(block(statsCss, '.grid[data-columns="2"] {')).toContain("repeat(2, minmax(0, 1fr))");
});

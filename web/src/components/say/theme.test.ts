// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

it("uses existing theme variables for the sheet, parsed rows and desktop panel", () => {
  const css = readFileSync(path.join(import.meta.dirname, "say.module.css"), "utf8");
  const tokens = readFileSync(path.join(import.meta.dirname, "../../styles/tokens.css"), "utf8");
  expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  const variables = [
    ...new Set([...css.matchAll(/var\((--[\w-]+)/g)].map((match) => match[1])),
  ].sort();
  for (const variable of variables) expect(tokens).toContain(`${variable}:`);
  expect(variables).toMatchInlineSnapshot(`
    [
      "--accent-base",
      "--accent-strong",
      "--accent-tint",
      "--card-shadow",
      "--font-display-stack",
      "--hairline",
      "--radius-card",
      "--surface",
      "--surface-input",
      "--surface-sunken",
      "--text",
      "--text-muted",
      "--unverified-fg",
    ]
  `);
  expect(tokens).toContain("prefers-color-scheme: dark");
  for (const accent of ["olive", "plum", "sea", "forest", "garnet"])
    expect(tokens).toContain(`[data-accent="${accent}"]`);
  expect(css).toContain("min-width: 1280px");
  expect(css).toContain("width: 58px");
  expect(css).toContain("width: 44px");
});

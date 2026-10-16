// @vitest-environment node
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("uses the shared theme variables for the AI row, picker and push switch at both breakpoints", () => {
  const css = readFileSync(new URL("./settings.module.css", import.meta.url), "utf8");
  const ui = readFileSync(new URL("../ui/ui.module.css", import.meta.url), "utf8");
  const chips = readFileSync(new URL("../ui/food-ui.module.css", import.meta.url), "utf8");
  const tokens = readFileSync(new URL("../../styles/tokens.css", import.meta.url), "utf8");
  const variables = [...new Set([...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]))].sort();
  expect(variables).toMatchInlineSnapshot(`
    [
      "--accent-band",
      "--accent-base",
      "--accent-strong",
      "--accent-tint",
      "--card-border",
      "--card-shadow",
      "--hairline",
      "--hairline-strong",
      "--radius-button-small",
      "--radius-card",
      "--radius-card-small",
      "--radius-pill",
      "--surface",
      "--surface-input",
      "--surface-selected",
      "--surface-sunken",
      "--switch-off",
      "--text",
      "--text-muted",
      "--touch-min",
    ]
  `);
  expect(css).toContain("@media (min-width: 1280px)");
  expect(css).toMatch(/\.switch\s*\{[^}]*width: 52px;[^}]*height: 32px;/s);
  expect(ui).toContain("border: var(--card-border)");
  expect(tokens).toContain("--card-border: 1px solid #3a332c");
  expect(tokens).toContain("--card-shadow: none");
  expect(chips).toContain("border-color: var(--accent-base)");
  expect(chips).toContain("background: var(--kit-tint)");
  for (const accent of ["plum", "sea", "forest", "garnet"])
    expect(
      tokens.match(new RegExp(`\\[data-accent="${accent}"\\]`, "g"))?.length,
    ).toBeGreaterThanOrEqual(2);
});

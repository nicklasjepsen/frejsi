// The entry button and the sheet in light, dark (derived, design gap 2) and the five accents, on
// the phone and at 1280 px: the styles name only token variables, so the dark block and
// `data-accent` restyle them. The snapshot is the set of variables in use; each is defined in the
// light root, and every colour among them is redefined for dark. No hex colour of its own.
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const here = import.meta.dirname;
const tokens = readFileSync(path.resolve(here, "../../styles/tokens.css"), "utf8").toLowerCase();
const css = readFileSync(path.join(here, "manual.module.css"), "utf8");
const nowCss = readFileSync(
  path.resolve(here, "../../app/[locale]/(app)/now/now.module.css"),
  "utf8",
);
const varsIn = (text: string) =>
  [...new Set([...text.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1] ?? ""))].sort();
const block = (text: string, selector: string) => {
  const start = text.indexOf(selector);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  return text.slice(text.indexOf("{", start), text.indexOf("}", start));
};
const COLOURS = [
  "--ground",
  "--surface",
  "--text",
  "--text-muted",
  "--hairline",
  "--card-shadow",
  "--accent-base",
];

describe("manual entry styles use tokens only", () => {
  it("names only variables tokens.css defines, and no hex colour of its own", () => {
    const used = varsIn(css);
    expect(used).toMatchInlineSnapshot(`
      [
        "--accent-base",
        "--card-shadow",
        "--font-body-stack",
        "--font-display-stack",
        "--ground",
        "--hairline",
        "--radius-card",
        "--text",
      ]
    `);
    const root = block(tokens, ":root {");
    for (const name of used) expect(root, name).toContain(`${name}:`);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(nowCss).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it("gets every colour it uses redefined in dark mode", () => {
    const dark = tokens.slice(tokens.indexOf("@media (prefers-color-scheme: dark)"));
    const used = varsIn(css).filter((v) => COLOURS.includes(v));
    expect(used.length).toBeGreaterThan(3);
    for (const name of used) expect(dark, name).toContain(`${name}:`);
  });

  it("takes the accent only from --accent-base, which data-accent switches for all five", () => {
    expect(varsIn(css).filter((v) => v.startsWith("--accent-"))).toEqual(["--accent-base"]);
    for (const accent of ["olive", "plum", "sea", "forest", "garnet"]) {
      expect(block(tokens, `[data-accent="${accent}"] {`), accent).toContain("--accent-base:");
    }
  });

  it("is a bottom sheet on the phone and a centred 440 px dialog from 1280 px", () => {
    expect(block(css, ".sheet {")).toMatch(/inset: auto 0 0 0[\s\S]*width: 100%/);
    const desktop = css.slice(css.indexOf("@media (min-width: 1280px)"));
    expect(block(desktop, ".sheet {")).toMatch(/margin: auto[\s\S]*width: 440px/);
  });
});

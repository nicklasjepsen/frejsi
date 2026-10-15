// Every view of meal detail in light, dark (derived, design gap 2) and the user's accent: the
// styles name only token variables, so the dark block and `data-accent` restyle them. The snapshot
// is the set of variables in use; each is defined in the light root, and every colour among them
// is redefined for dark. No hex colour of its own.
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const here = import.meta.dirname;
const tokens = readFileSync(path.resolve(here, "../../styles/tokens.css"), "utf8").toLowerCase();
const css = readFileSync(path.join(here, "meal-detail.module.css"), "utf8");
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
  "--surface-sunken",
  "--text",
  "--text-muted",
  "--hairline",
  "--card-shadow",
  "--card-border",
  "--accent-base",
];

describe("meal detail styles (phone, desktop, simple) use tokens only", () => {
  it("names only variables tokens.css defines", () => {
    const used = varsIn(css);
    expect(used).toMatchInlineSnapshot(`
      [
        "--accent-base",
        "--card-border",
        "--card-shadow",
        "--font-body-stack",
        "--font-display-stack",
        "--ground",
        "--hairline",
        "--phone-safe-top",
        "--radius-card",
        "--radius-card-simple",
        "--surface",
        "--surface-sunken",
        "--text",
        "--text-muted",
        "--touch-min-simple",
      ]
    `);
    const root = block(tokens, ":root {");
    for (const name of used) expect(root, name).toContain(`${name}:`);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it("gets every colour it uses redefined in dark mode", () => {
    const dark = tokens.slice(tokens.indexOf("@media (prefers-color-scheme: dark)"));
    const used = varsIn(css).filter((v) => COLOURS.includes(v));
    expect(used.length).toBeGreaterThan(5);
    for (const name of used) expect(dark, name).toContain(`${name}:`);
  });

  it("takes the accent only from the accent variables, which data-accent switches", () => {
    const accents = varsIn(css).filter((v) => v.startsWith("--accent-"));
    expect(accents).toEqual(["--accent-base"]);
    for (const accent of ["olive", "plum", "sea", "forest", "garnet"]) {
      expect(block(tokens, `[data-accent="${accent}"] {`), accent).toContain("--accent-base:");
    }
  });

  it("covers the shell under 1280 px only, and draws the drawn sizes", () => {
    const phone = css.slice(css.indexOf("@media (max-width: 1279.98px)"));
    expect(block(phone, ".simple {")).toMatch(/position: fixed[\s\S]*inset: 0/);
    expect(block(css, ".heroPhoto {")).toMatch(/72px[\s\S]*72px[\s\S]*border-radius: 16px/);
    expect(block(css, ".bannerPhoto {")).toContain("height: 180px");
    expect(block(css, '.title[data-size="desktop"] {')).toContain("font-size: 26px");
    expect(block(css, ".simplePhoto {")).toMatch(/height: 220px[\s\S]*border-radius: 22px/);
    expect(block(css, ".simpleHeading {")).toContain("26px");
    expect(block(css, ".simpleName {")).toContain("22px");
    expect(block(css, ".simpleAmount {")).toContain("font-size: 18px");
    expect(block(css, ".simpleTotalValue {")).toContain("font-size: 30px");
    expect(block(css, '.compareChips [role="radio"] {')).toMatch(/34px[\s\S]*font-size: 13px/);
    expect(block(css, ".actions > button {")).toMatch(/min-height: 36px[\s\S]*border-radius: 10px/);
  });
});

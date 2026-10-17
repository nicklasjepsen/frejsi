// Dark mode and the accents reach these components through tokens only: every colour the glucose
// styles use is a variable that tokens.css defines in the light block, redefines for the dark
// scheme with the Nu-Moerk values, and (for the accent ones) per data-accent with the Farve-Nu
// values. Nothing here is a hex colour.
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const here = import.meta.dirname;
const read = (p: string) => readFileSync(p, "utf8");
const tokens = read(path.resolve(here, "../../styles/tokens.css")).toLowerCase();
const glucoseCss = read(path.join(here, "glucose.module.css"));
const nowCss = read(path.resolve(here, "../../app/[locale]/(app)/now/now.module.css"));
const artboards = path.resolve(here, "../../../../docs/design/artboards");

const varsIn = (css: string) =>
  [...new Set([...css.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1] ?? ""))].sort();
const block = (css: string, selector: string) => {
  const start = css.indexOf(selector);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  return css.slice(css.indexOf("{", start), css.indexOf("}", start));
};
const hexesIn = (html: string) => [
  ...new Set([...html.matchAll(/#[0-9a-f]{6}\b/gi)].map((m) => m[0].toLowerCase())),
];

const COLOUR_VARS = [
  "--text",
  "--text-muted",
  "--gridline",
  "--accent-base",
  "--accent-tint",
  "--accent-band",
  "--meal-marker",
  "--meal-bolus-marker",
];

describe("glucose styles use tokens only (Nu-Moerk, Farve-Nu-*)", () => {
  it("names only variables tokens.css defines, and no hex colour of its own", () => {
    const used = varsIn(glucoseCss + nowCss);
    expect(used).toMatchInlineSnapshot(`
      [
        "--accent-band",
        "--accent-band-opacity",
        "--accent-base",
        "--accent-strong",
        "--accent-tint",
        "--font-body-stack",
        "--gridline",
        "--hairline",
        "--meal-bolus-marker",
        "--meal-marker",
        "--text",
        "--text-muted",
      ]
    `);
    const root = block(tokens, ":root {");
    for (const name of used) expect(root, name).toContain(`${name}:`);
    expect(glucoseCss).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(nowCss).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it("gets the Nu-Moerk values in dark mode: every colour the glucose styles use is redefined there", () => {
    const dark = tokens.slice(tokens.indexOf("@media (prefers-color-scheme: dark)"));
    const used = varsIn(glucoseCss + nowCss).filter((v) => COLOUR_VARS.includes(v));
    expect(used).toEqual(expect.arrayContaining(["--text", "--text-muted", "--accent-base"]));
    for (const name of used) expect(dark, name).toContain(`${name}:`);
    // The dark artboard's colours are the dark block's values, not anything the components carry.
    const moerk = hexesIn(read(path.join(artboards, "Nu-Moerk.dc.html")));
    for (const hex of ["#1f1b17", "#2a2521", "#f1eadf", "#b5aa9a", "#9dae78", "#3a332c"]) {
      expect(moerk, hex).toContain(hex);
      expect(dark, hex).toContain(hex);
    }
  });

  it("gets each Farve-Nu accent through data-accent: the arrow stroke of each artboard is that accent's base", () => {
    const boards: Record<string, string> = {
      "Farve-Nu-Blomme": "plum",
      "Farve-Nu-Hav": "sea",
      "Farve-Nu-Skov": "forest",
      "Farve-Nu-Granat": "garnet",
      Main: "olive",
    };
    for (const [board, accent] of Object.entries(boards)) {
      const html = read(path.join(artboards, `${board}.dc.html`));
      const arrow = /aria-label="stiger langsomt"><path[^>]*stroke="(#[0-9A-Fa-f]{6})"/.exec(html);
      expect(arrow, board).not.toBeNull();
      const rule = block(tokens, `[data-accent="${accent}"] {`);
      expect(rule, board).toContain(`--accent-base: ${(arrow?.[1] ?? "").toLowerCase()}`);
    }
    // The arrow and the dot take the accent from the variable, so the attribute switches them.
    expect(block(glucoseCss, ".arrow {")).toContain("var(--accent-base)");
    expect(block(glucoseCss, ".dot {")).toContain("var(--accent-base)");
  });

  it("gives simpleMode the 148 px number on the phone and 200 px from 1280 px", () => {
    expect(block(glucoseCss, '.value[data-size="simple"] .number {')).toContain("font-size: 148px");
    const desktop = glucoseCss.slice(glucoseCss.indexOf("@media (min-width: 1280px)"));
    expect(block(desktop, '.value[data-size="simple"] .number {')).toContain("font-size: 200px");
    expect(block(glucoseCss, '.value[data-size="phone"] .number {')).toContain("font-size: 100px");
    expect(block(glucoseCss, '.value[data-size="desktop"] .number {')).toContain("font-size: 92px");
  });
});

describe("the meal and week curves in dark mode and the five accents (v0.3.0 plan §7, design gap 2)", () => {
  const dark = tokens.slice(tokens.indexOf("@media (prefers-color-scheme: dark)"));
  const darkRoot = block(dark, ":root");

  it("takes the derived dark values: curve #f1eadf, meal marker #e08a6c, band at 0.14, gridlines #6e6458", () => {
    expect(darkRoot).toContain("--text: #f1eadf");
    expect(darkRoot).toContain("--meal-marker: #e08a6c");
    expect(darkRoot).toContain("--meal-bolus-marker: #e08a6c");
    expect(darkRoot).toContain("--accent-band-opacity: 0.14");
    expect(darkRoot).toContain("--gridline: #6e6458");
  });

  it("draws the curves in the text colour and the meals in the meal colours, whatever the accent", () => {
    for (const cls of [".line {", ".previousLine {", ".weekLine {", ".endDot {"]) {
      expect(block(glucoseCss, cls), cls).toMatch(/var\(--text\)/);
    }
    expect(block(glucoseCss, ".mealLine {")).toContain("var(--meal-marker)");
    expect(block(glucoseCss, ".mealDot {")).toContain("var(--meal-marker)");
    // v0.6.0: the food symbol is terracotta like the line; the symptom marker is the text colour.
    expect(block(glucoseCss, ".mealSymbol {")).toContain("var(--meal-marker)");
    expect(block(glucoseCss, ".swatchMealPlate {")).toContain("var(--meal-marker)");
    expect(block(glucoseCss, ".symptomMarker {")).toContain("var(--text)");
    expect(block(glucoseCss, ".symptomMarker {")).not.toContain("meal");
    expect(block(glucoseCss, ".bolus {")).toContain("var(--meal-bolus-marker)");
    expect(block(glucoseCss, ".tickMeal {")).toContain("var(--meal-bolus-marker)");
    expect(block(glucoseCss, ".band {")).toContain("var(--accent-band)");
  });

  it("lets an accent change the band only: no accent block touches the curve, meal or gridline colours", () => {
    for (const accent of ["olive", "plum", "sea", "forest", "garnet"]) {
      for (const css of [tokens, dark]) {
        const rule = block(css, `[data-accent="${accent}"] {`);
        expect(rule, accent).toContain("--accent-band:");
        for (const name of ["--text:", "--meal-marker:", "--meal-bolus-marker:", "--gridline:"]) {
          expect(rule, `${accent} ${name}`).not.toContain(name);
        }
      }
    }
  });
});

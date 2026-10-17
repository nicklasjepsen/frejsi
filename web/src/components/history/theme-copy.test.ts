import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { messageStrings } from "@frejsi/shared/dosing-vocabulary";
import da from "../../../messages/da/history.json";
import en from "../../../messages/en/history.json";
const read = (name: string) => readFileSync(path.resolve(import.meta.dirname, name), "utf8");
it("translates every history string and keeps the copy descriptive", () => {
  expect(Object.keys(da).sort()).toEqual(Object.keys(en).sort());
  for (const copy of [da, en]) {
    for (const [, text] of messageStrings({ history: copy })) {
      expect(text).not.toMatch(
        /(?<![\p{L}\p{N}_])(bør|skal|should|take|give|giv|næste gang|next time)(?![\p{L}\p{N}_])/iu,
      );
      expect(text).not.toMatch(/bolus/i);
    }
  }
});
it("uses the inherited light, dark and accent variables at 360 and 1280 px", () => {
  const css = read("history.module.css") + read("../day/day.module.css");
  const tokens = read("../../styles/tokens.css");
  const variables = [...new Set([...css.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]))].sort();
  expect(variables).toMatchInlineSnapshot(`
    [
      "--accent-base",
      "--card-border",
      "--card-shadow",
      "--font-display-stack",
      "--hairline",
      "--hairline-strong",
      "--radius-card",
      "--radius-card-simple",
      "--surface",
      "--surface-selected",
      "--surface-sunken",
      "--text",
      "--text-muted",
    ]
  `);
  for (const name of variables) expect(tokens).toContain(`${name}:`);
  expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  expect(css).toContain("@media (min-width: 1280px)");
  expect(css).toContain("grid-template-columns: minmax(0, 720px) minmax(280px, 1fr)");
  expect(css).toContain("min-height: 420px");
  const dark = tokens.slice(tokens.indexOf("@media (prefers-color-scheme: dark)"));
  for (const name of [
    "--text",
    "--text-muted",
    "--surface",
    "--surface-sunken",
    "--card-shadow",
    "--card-border",
    "--hairline-strong",
  ])
    expect(dark).toContain(`${name}:`);
  for (const accent of ["olive", "plum", "sea", "forest", "garnet"]) {
    expect(tokens).toContain(`[data-accent="${accent}"]`);
    expect(dark).toContain(`[data-accent="${accent}"]`);
  }
});
it("lets the shell's gutter be the phone's only one and keeps hover effects off touch screens", () => {
  const css = read("history.module.css");
  const phone = css.slice(0, css.indexOf("@media (min-width: 1280px)"));
  expect(phone).toMatch(/\.page \{[^}]*padding: 0 0 32px;/);
  const day = read("../day/day.module.css");
  const hover = day.slice(day.indexOf("@media (hover: hover)"));
  expect(hover).toContain(".cellLink:hover");
  expect(day.slice(0, day.indexOf("@media (hover: hover)"))).not.toContain(":hover");
});
it("keeps the viewer branch's executable imports free of chart and statistics components", () => {
  const source = read("ViewerDays.tsx");
  expect(source).not.toMatch(/import(?! type).*from.*(?:glucose|stats|DaySection|HistoryScreen)/);
  expect(source).not.toMatch(/<Glucose|<PeakValue|<StatTile/);
});

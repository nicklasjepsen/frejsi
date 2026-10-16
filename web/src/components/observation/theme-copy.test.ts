import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { assertNoDosing } from "@frejsi/shared/ai/guard";
import { messageStrings } from "@frejsi/shared/dosing-vocabulary";
import { getMessages } from "@/lib/i18n/messages";
const read = (file: string) => readFileSync(path.resolve(import.meta.dirname, file), "utf8");
it("matches every observation translation and checks generated-text vocabulary without an allow-list", () => {
  const keys: string[][] = [];
  for (const locale of ["da", "en"] as const) {
    const messages = getMessages(locale);
    const strings = messageStrings({
      meal: messages.mealDetail.observation,
      week: messages.historyWeek.observation,
      link: messages.history.observation,
    });
    keys.push(strings.map(([key]) => key));
    for (const [key, text] of strings) assertNoDosing(text, key);
  }
  expect(keys[0]).toEqual(keys[1]);
});
it("snapshots inherited light/dark and all accents for cards at 360 and 1280 px", () => {
  const css = read("observation.module.css");
  const tokens = read("../../styles/tokens.css");
  const variables = (source: string): Record<string, string> =>
    Object.fromEntries(
      [...source.matchAll(/(--[a-z-]+):\s*([^;]+);/g)].map((m) => [m[1] ?? "", m[2]?.trim() ?? ""]),
    );
  const block = (source: string, selector: string) => {
    const start = source.indexOf(selector);
    expect(start).toBeGreaterThanOrEqual(0);
    return source.slice(source.indexOf("{", start) + 1, source.indexOf("}", start));
  };
  const used = [...new Set([...css.matchAll(/var\((--[a-z-]+)\)/g)].map((m) => m[1] ?? ""))].sort();
  expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  for (const scheme of ["light", "dark"]) {
    const source =
      scheme === "light"
        ? tokens.slice(0, tokens.indexOf("@media (prefers-color-scheme: dark)"))
        : tokens.slice(tokens.indexOf("@media (prefers-color-scheme: dark)"));
    for (const accent of ["olive", "plum", "sea", "forest", "garnet"]) {
      const values = {
        ...variables(block(tokens, ":root")),
        ...variables(block(source, ":root")),
        ...variables(block(source, `[data-accent="${accent}"]`)),
      };
      const resolved = Object.fromEntries(used.map((key) => [key, values[key]]));
      for (const key of used) expect(values[key]).toBeDefined();
      expect({ widths: [360, 1280], values: resolved }).toMatchSnapshot(
        `${scheme} ${accent}: observation, questions, phone week`,
      );
    }
  }
  expect(css).toContain("@media (min-width: 1280px)");
  expect(css).toContain("min-height: 44px");
  expect(css).toMatch(/\.phoneSummary,\s*\.link\s*{\s*display:\s*none;/);
});

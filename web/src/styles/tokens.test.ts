import { readFileSync } from "node:fs";
import path from "node:path";

import { Accent } from "@frejsi/shared";
import { describe, expect, it } from "vitest";

// Prettier writes hex colours in lower case; tokens.json has them in upper case. Compare lower.
const css = readFileSync(path.join(import.meta.dirname, "tokens.css"), "utf8").toLowerCase();
const tokens = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "../../../docs/design/tokens.json"), "utf8"),
) as {
  color: {
    light: {
      ground: string;
      surface: string;
      surfaceSunken: string;
      text: string;
      textMuted: string;
      hairline: string;
      accent: Record<string, { base: string; strong: string; onAccent: string }>;
    };
    dark: {
      ground: string;
      surface: string;
      text: string;
      textMuted: string;
      hairline: string;
      accent: Record<string, { base: string; strong: string; onAccent: string }>;
    };
  };
  nav: { desktopSidebar: { width: number }; desktopSidebarSimple: { width: number } };
  breakpoints: { desktopMin: number };
};

const lower = (value: string) => value.toLowerCase();

/** The declarations of one CSS block, found by its selector line. */
function block(selector: string): string {
  const start = css.indexOf(selector.toLowerCase());
  expect(start, selector).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open, close);
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The rulesets whose selector starts with `guard`, keyed by what follows it ("" for the guard
 * alone), each a sorted list of declarations without comments.
 */
function darkRulesets(guard: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const pattern = new RegExp(`${escape(guard)}((?: [^{\\n]+)?) \\{\\n([^}]*)\\}`, "g");
  for (const match of css.matchAll(pattern)) {
    const declarations = (match[2] ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("/*"))
      .sort();
    out[(match[1] ?? "").trim()] = declarations;
  }
  return out;
}

describe("tokens.css (docs/design/tokens.json)", () => {
  it("defines the light palette on :root", () => {
    const root = block(":root {");
    const light = tokens.color.light;
    expect(root).toContain(`--ground: ${lower(light.ground)}`);
    expect(root).toContain(`--surface: ${lower(light.surface)}`);
    expect(root).toContain(`--surface-sunken: ${lower(light.surfaceSunken)}`);
    expect(root).toContain(`--text: ${lower(light.text)}`);
    expect(root).toContain(`--text-muted: ${lower(light.textMuted)}`);
    expect(root).toContain(`--hairline: ${lower(light.hairline)}`);
    // Olive is the default accent, so :root carries it without a data-accent.
    expect(root).toContain(`--accent-base: ${lower(light.accent.olive?.base ?? "")}`);
    expect(root).toContain(`--accent-strong: ${lower(light.accent.olive?.strong ?? "")}`);
  });

  it("switches the accent variables for all five colours through data-accent", () => {
    expect(Object.keys(tokens.color.light.accent).sort()).toEqual([...Accent.options].sort());
    for (const accent of Accent.options) {
      const values = tokens.color.light.accent[accent];
      const rule = block(`[data-accent="${accent}"] {`);
      expect(rule, accent).toContain(`--accent-base: ${lower(values?.base ?? "")}`);
      expect(rule, accent).toContain(`--accent-strong: ${lower(values?.strong ?? "")}`);
      expect(rule, accent).toContain(`--accent-on: ${lower(values?.onAccent ?? "")}`);
      expect(rule, accent).toMatch(/--accent-tint: #[0-9a-f]{6}/);
    }
  });

  it("follows prefers-color-scheme with the Nu-Moerk values", () => {
    const dark = css.slice(css.indexOf("@media (prefers-color-scheme: dark)"));
    expect(dark.length).toBeGreaterThan(0);
    const d = tokens.color.dark;
    expect(dark).toContain(`--ground: ${lower(d.ground)}`);
    expect(dark).toContain(`--surface: ${lower(d.surface)}`);
    expect(dark).toContain(`--text: ${lower(d.text)}`);
    expect(dark).toContain(`--text-muted: ${lower(d.textMuted)}`);
    expect(dark).toContain(`--hairline: ${lower(d.hairline)}`);
    expect(dark).toContain(`--accent-base: ${lower(d.accent.olive?.base ?? "")}`);
    expect(dark).toContain(`--accent-strong: ${lower(d.accent.olive?.strong ?? "")}`);
    expect(dark).toContain(`--accent-on: ${lower(d.accent.olive?.onAccent ?? "")}`);
    // Cards lose the hairline shadow and gain a border in the dark.
    expect(dark).toContain("--card-shadow: none");
    expect(dark).toContain(`--card-border: 1px solid ${lower(d.hairline)}`);
    // Every accent has a lifted dark value (design gap 2: derived by the same rule as olive).
    for (const accent of Accent.options) {
      expect(dark, accent).toContain(`[data-accent="${accent}"]`);
    }
  });

  it("lets a chosen theme override the device: light guards the media query, dark forces it", () => {
    expect(css).toContain(
      '@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) {',
    );
    expect(block(':root[data-theme="light"] {')).toContain("color-scheme: light");
    expect(block(':root[data-theme="dark"] {')).toContain("color-scheme: dark");
    expect(block(':root:not([data-theme="light"]) {')).toContain("color-scheme: dark");
    // Only the two dark blocks carry the dark ground; the light values stay on :root.
    expect(block(":root {")).not.toContain(`--ground: ${lower(tokens.color.dark.ground)}`);
  });

  it("declares the same dark values for a device that prefers dark and for a forced dark", () => {
    const media = darkRulesets(':root:not([data-theme="light"])');
    const forced = darkRulesets(':root[data-theme="dark"]');
    expect(Object.keys(media).sort()).toEqual(
      ["", ...Accent.options.map((accent) => `[data-accent="${accent}"]`)].sort(),
    );
    expect(forced).toEqual(media);
    expect(media[""]).toContain(`--ground: ${lower(tokens.color.dark.ground)};`);
    expect(media[""]).toContain("color-scheme: dark;");
  });

  it("carries the navigation sizes and the desktop breakpoint", () => {
    const root = block(":root {");
    expect(root).toContain(`--sidebar-width: ${tokens.nav.desktopSidebar.width}px`);
    expect(root).toContain(`--sidebar-width-simple: ${tokens.nav.desktopSidebarSimple.width}px`);
    expect(tokens.breakpoints.desktopMin).toBe(1280);
  });
});

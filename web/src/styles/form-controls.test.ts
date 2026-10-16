// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// iOS Safari zooms the page into any focused text control whose computed font-size is under
// 16px. The body is 15px, so every rule that sets a control's font must land at 16px or more:
// the global rule in globals.css, and every module rule that overrides it (a class selector
// beats an element selector) or that says `font: inherit` under a smaller parent.

const MIN_PX = 16;
const srcDir = path.resolve(import.meta.dirname, "..");

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return cssFiles(full);
    return entry.name.endsWith(".css") ? [full] : [];
  });
}

interface Rule {
  file: string;
  selector: string;
  declarations: string;
}

/** Every `selector { declarations }` pair in a file, with comments stripped and @-blocks unwrapped. */
function rules(file: string): Rule[] {
  const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Rule[] = [];
  for (const chunk of css.split("}")) {
    const open = chunk.lastIndexOf("{");
    if (open < 0) continue;
    const head = chunk.slice(0, open);
    const selector = head.slice(head.lastIndexOf("{") + 1).trim();
    if (selector.startsWith("@")) continue;
    out.push({ file: path.relative(srcDir, file), selector, declarations: chunk.slice(open + 1) });
  }
  return out;
}

/** A rule that styles a text control: an element selector, or the `.input` class the inputs carry. */
const controlSelector = /\b(input|textarea|select)\b/;

const allRules = cssFiles(srcDir).flatMap(rules);
const controlRules = allRules.filter((rule) => controlSelector.test(rule.selector));

function fontSizePx(declarations: string): number | undefined {
  const match = /font-size:\s*([^;]+);/.exec(declarations);
  if (!match) return undefined;
  const px = /^(\d+(?:\.\d+)?)px$/.exec(match[1]?.trim() ?? "");
  return px ? Number(px[1]) : Number.NaN;
}

describe("form controls never render under 16px (iOS focus zoom)", () => {
  it("finds the control rules it guards", () => {
    const files = new Set(controlRules.map((rule) => rule.file));
    expect(files).toContain("styles/globals.css");
    expect(files).toContain("components/ui/food-ui.module.css");
    expect(files).toContain("components/settings/settings.module.css");
    expect(files).toContain("app/[locale]/(app)/log/log.module.css");
  });

  it("sets 16px on every input, textarea and select globally", () => {
    const global = allRules.find(
      (rule) => rule.file === "styles/globals.css" && rule.selector === "input,\ntextarea,\nselect",
    );
    expect(global).toBeDefined();
    expect(fontSizePx(global?.declarations ?? "")).toBe(MIN_PX);
  });

  it("keeps the .input class used by TextInput and the settings fields at 16px", () => {
    for (const file of [
      "components/ui/food-ui.module.css",
      "components/settings/settings.module.css",
      "components/people/people.module.css",
    ]) {
      const rule = allRules.find(
        (candidate) => candidate.file === file && candidate.selector === ".input",
      );
      expect(rule, file).toBeDefined();
      expect(fontSizePx(rule?.declarations ?? ""), file).toBeGreaterThanOrEqual(MIN_PX);
    }
  });

  it("never declares a font-size under 16px, or a non-px one, in a control rule", () => {
    for (const rule of controlRules) {
      const size = fontSizePx(rule.declarations);
      if (size === undefined) continue;
      expect(size, `${rule.file}: ${rule.selector}`).toBeGreaterThanOrEqual(MIN_PX);
    }
  });

  it("follows every `font:` shorthand in a control rule with an explicit 16px font-size", () => {
    // `font: inherit` takes the parent's size, which is 15px on the body and 14px under some
    // labels; `font: 700 15px ...` sets one outright. Either way the rule must restate the size.
    for (const rule of controlRules) {
      const shorthand = rule.declarations.indexOf("font:");
      if (shorthand < 0) continue;
      const after = rule.declarations.slice(shorthand);
      const size = fontSizePx(after);
      expect(size, `${rule.file}: ${rule.selector}`).toBeGreaterThanOrEqual(MIN_PX);
    }
  });
});

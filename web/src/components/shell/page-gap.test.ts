import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// Issue 214: the gap between the phone header's space name and a page lives in one place, the
// shell's `.main`, so no screen can miss it or draw its own. These read the stylesheets as text;
// the e2e (phone-header-gap.spec.ts) measures the result in a browser.

const components = path.join(import.meta.dirname, "..");
const app = path.join(components, "..", "app", "[locale]", "(app)");
const read = (file: string): string =>
  readFileSync(
    file.startsWith("app/") ? path.join(app, file.slice(4)) : path.join(components, file),
    "utf8",
  );

/** The stylesheet without its `@media` blocks: the rules that apply on the phone. */
function outsideMedia(css: string): string {
  let out = "";
  let i = 0;
  while (i < css.length) {
    const at = css.indexOf("@media", i);
    if (at < 0) return out + css.slice(i);
    out += css.slice(i, at);
    let depth = 0;
    let j = css.indexOf("{", at);
    for (; j < css.length; j++) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}" && --depth === 0) break;
    }
    i = j + 1;
  }
  return out;
}

/** The body of the rule whose selector is exactly `selector`, at the start of a line. */
function rule(css: string, selector: string): string {
  const match = new RegExp(`^${selector.replace(".", "\\.")} \\{([^}]*)\\}`, "m").exec(css);
  expect(match, selector).not.toBeNull();
  return match?.[1] ?? "";
}

/** The rule's top padding as written (`padding-top` wins over the shorthand's first value). */
function topPadding(body: string): string {
  const top = /padding-top:\s*([^;]+);/.exec(body);
  if (top?.[1]) return top[1].trim();
  const short = /(?:^|[\s;])padding:\s*([^;]+);/.exec(body);
  return short?.[1]?.trim().split(/\s+/)[0] ?? "0";
}

/** The rule at 1280 px and up, or "" when the stylesheet has none for it. */
function desktopRule(css: string, selector: string): string {
  const parts = css.split("@media (min-width: 1280px)").slice(1);
  for (const part of parts) {
    const match = new RegExp(`\\n\\s*${selector.replace(".", "\\.")} \\{([^}]*)\\}`).exec(part);
    if (match?.[1] !== undefined) return match[1];
  }
  return "";
}

describe("the gap under the phone header", () => {
  const shell = read("shell/shell.module.css");
  const phoneOnly = shell.split("@media (max-width: 1279.98px)").slice(1).join("");

  // AppShell renders the phone header and then `<main>` inside `.main`: padding `.main` would move
  // the header down instead of opening the gap under it.
  it("is the shell's: 20 px on top of the page's `main`, under the header, below 1280 px", () => {
    expect(topPadding(rule(phoneOnly.replace(/^\s+/gm, ""), ".shell main"))).toBe("20px");
    expect(topPadding(rule(outsideMedia(shell), ".main"))).toMatch(/^0(px)?$/);
  });

  it("keeps the desktop main column's own padding from 1280 px, and nothing on top of it", () => {
    expect(desktopRule(shell, ".main")).toMatch(/padding: 28px 32px 40px;/);
    expect(shell.split("@media (min-width: 1280px)").slice(1).join("")).not.toContain(
      ".shell main",
    );
  });

  // /eat and /feel draw no phone header; the same 20 px is their gap to the top of the screen,
  // which their own `.page` drew before, so they do not move.
  it("pads chromeless screens the same, so /eat and /feel keep their place", () => {
    expect(shell).not.toMatch(/data-chromeless="true"\][^{]*main/);
  });

  it.each([
    ["library/library.module.css", ".page"],
    ["library/library.module.css", ".editPage"],
    ["settings/settings.module.css", ".page"],
    ["simple/simple.module.css", ".page"],
    ["symptoms/symptoms.module.css", ".page"],
    ["history/history.module.css", ".page"],
    ["history-week/history-week.module.css", ".page"],
    ["recipes/recipes.module.css", ".screen"],
    ["shell/shell.module.css", ".calmPage"],
    // The owner's call on #218: one 20 px everywhere, so Nu (28), Nu-Simpel (36), I dag (28),
    // Spørg (20) and Personer (12) drop the hand-in gaps they drew themselves.
    ["app/now/now.module.css", ".page"],
    ["app/now/now.module.css", ".simple"],
    ["app/today/today.module.css", ".page"],
    ["estimate/estimate.module.css", ".page"],
    ["people/people.module.css", ".page"],
  ])("is not drawn again by %s %s", (file, selector) => {
    expect(topPadding(rule(outsideMedia(read(file)), selector))).toMatch(/^0(px)?$/);
  });
});

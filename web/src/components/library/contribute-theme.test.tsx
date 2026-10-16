import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";

import { I18nProvider } from "@/lib/i18n/Provider";
import { getMessages } from "@/lib/i18n/messages";

import { FoodForm } from "./FoodForm";
import { artboardFoods, fakeFoodsApi } from "./test-support";

afterEach(cleanup);

const read = (file: string) => readFileSync(path.resolve(import.meta.dirname, file), "utf8");
const css = read("library.module.css");
const ui = read("../ui/ui.module.css");
const tokens = read("../../styles/tokens.css");
const block = (source: string, selector: string) => {
  const start = source.indexOf(selector);
  expect(start).toBeGreaterThanOrEqual(0);
  return source.slice(source.indexOf("{", start) + 1, source.indexOf("}", start));
};
const variables = (source: string): Record<string, string> =>
  Object.fromEntries(
    [...source.matchAll(/(--[a-z-]+):\s*([^;]+);/g)].map((match) => [
      match[1] ?? "",
      (match[2] ?? "").trim(),
    ]),
  );

// The checkbox row ("Send rettelsen …") is the shared `Checkbox` (`.checkbox` in ui.module.css,
// the same row as Favorit) and the status line `.muted` / `.problem`.
it("renders the checkbox row and its status line from tokens in light, dark and the five accents", () => {
  const rows = [
    block(ui, ".checkbox {"),
    block(ui, ".checkbox input {"),
    block(css, ".muted {"),
    block(css, ".problem {"),
  ];
  const names = rows.flatMap((r) => [...r.matchAll(/var\((--[a-z-]+)\)/g)].map((m) => m[1] ?? ""));
  const used = [...new Set(names)].sort();
  expect(used.length).toBeGreaterThan(0);
  expect(rows.join("")).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  const schemes = {
    light: tokens.slice(0, tokens.indexOf("@media (prefers-color-scheme: dark)")),
    dark: tokens.slice(tokens.indexOf("@media (prefers-color-scheme: dark)")),
  };
  for (const [scheme, source] of Object.entries(schemes)) {
    for (const accent of ["olive", "plum", "sea", "forest", "garnet"]) {
      const values = {
        ...variables(block(tokens, ":root")),
        ...variables(block(source, ":root")),
        ...variables(block(source, `[data-accent="${accent}"]`)),
      };
      for (const name of used) expect(values[name], `${scheme} ${accent} ${name}`).toBeDefined();
      expect(Object.fromEntries(used.map((name) => [name, values[name]]))).toMatchSnapshot(
        `${scheme} ${accent}`,
      );
    }
  }
});

it("keeps the row at one size for the phone (360) and the desktop panel (1280)", () => {
  const row = block(ui, ".checkbox {");
  expect(row).toContain("min-height: var(--touch-min)");
  expect(block(tokens, ":root")).toContain("--touch-min: 44px");
  // No media query hides or resizes the row at either width.
  for (const start of [...ui.matchAll(/@media[^{]*\{/g)].map((m) => m.index)) {
    let depth = 0;
    let end = start;
    for (; end < ui.length; end++) {
      if (ui[end] === "{") depth++;
      if (ui[end] === "}" && --depth === 0) break;
    }
    expect(ui.slice(start, end)).not.toMatch(/\.checkbox\b/);
  }
});

// The rendered form, so removing the checkbox or the outcome line fails here: the row is the
// `.checkbox` label from the stylesheet checked above, at every mode and accent, and it is the
// same markup in the phone page and the desktop panel (one form, no width-specific branch).
it("renders the checkbox row and the outcome line in every mode and accent", async () => {
  const api = fakeFoodsApi(artboardFoods());
  api.available = ["off"];
  vi.stubGlobal("fetch", api.fetch);
  const food = artboardFoods().find((row) => row.id === "f-rye");
  if (!food) throw new Error("f-rye");
  for (const mode of ["light", "dark"]) {
    for (const accent of ["olive", "plum", "sea", "forest", "garnet"]) {
      const { container, unmount } = render(
        <div data-accent={accent} data-mode={mode}>
          <I18nProvider locale="da" messages={getMessages("da")}>
            <FoodForm spaceId="s1" food={food} onSaved={vi.fn()} />
          </I18nProvider>
        </div>,
      );
      const box = await screen.findByRole("checkbox", {
        name: /Send rettelsen til Open Food Facts/,
      });
      expect(box.closest("label")?.className).toMatch(/checkbox/);
      fireEvent.click(box);
      fireEvent.click(screen.getByRole("button", { name: "Gem" }));
      await waitFor(() => {
        expect(screen.getByTestId("contribution-outcome")).toHaveTextContent("Sendt til");
      });
      expect(box.closest("label")?.outerHTML).toMatchSnapshot(`row ${mode} ${accent}`);
      expect(
        container.querySelector("[data-testid=contribution-outcome]")?.outerHTML,
      ).toMatchSnapshot(`outcome ${mode} ${accent}`);
      unmount();
    }
  }
  vi.unstubAllGlobals();
});

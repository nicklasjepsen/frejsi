import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import messages from "../../../messages/da.json";
import { Badge } from "../ui/Badge";
import { Chip } from "../ui/Chip";
import { PhotoTile } from "./PhotoTile";

const tokens = readFileSync("src/styles/tokens.css", "utf8");
const kitCss = readFileSync("src/components/ui/food-ui.module.css", "utf8");
const foodCss = readFileSync("src/components/food/food.module.css", "utf8");

describe("food kit theme matrix", () => {
  for (const mode of ["light", "dark"]) {
    for (const accent of ["olive", "plum", "sea", "forest", "garnet"]) {
      it(`${accent} ${mode}: checked badge, pressed chip and selected tile`, () => {
        const source =
          mode === "dark"
            ? tokens.slice(tokens.indexOf("@media"))
            : tokens.slice(0, tokens.indexOf("@media"));
        const palette = new RegExp(`\\[data-accent="${accent}"\\] \\{([^}]+)\\}`).exec(source)?.[1];
        expect(palette).toBeDefined();
        const html = renderToStaticMarkup(
          <NextIntlClientProvider locale="da" messages={messages}>
            <div data-accent={accent} data-mode={mode}>
              <Badge verified />
              <Chip pressed>Fictional food</Chip>
              <PhotoTile title="Fictional food" verified selected />
            </div>
          </NextIntlClientProvider>,
        );
        expect({
          palette,
          html,
          tintRules: kitCss.slice(0, kitCss.indexOf(".badge")),
        }).toMatchSnapshot();
      });
    }
  }
  it("uses the prescribed tint mixes, placeholder tokens, selected border and dark border", () => {
    for (const accent of ["sea", "forest", "garnet"])
      expect(kitCss).toContain(`[data-accent="${accent}"]`);
    expect(kitCss).toContain("color-mix(in srgb, var(--accent-base) 12%, var(--surface))");
    expect(kitCss).toContain("color-mix(in srgb, var(--accent-base) 30%, var(--surface))");
    expect(foodCss).toContain("background: #e4d8c3");
    expect(foodCss).toContain("color: #7a6b52");
    expect(foodCss).toContain("border: 3px solid transparent");
    expect(foodCss).toContain("border-color: var(--accent-base)");
    expect(foodCss).toContain("@media (prefers-color-scheme: dark)");
    expect(foodCss).toContain("box-shadow: none");
  });
});

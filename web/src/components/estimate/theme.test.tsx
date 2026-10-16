import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import messages from "../../../messages/en";
import { PhotoTile } from "../food/PhotoTile";
import { EstimateView } from "./EstimateView";

const tokens = readFileSync("src/styles/tokens.css", "utf8");
const viewCss = readFileSync("src/components/estimate/estimate.module.css", "utf8");
const foodCss = readFileSync("src/components/food/food.module.css", "utf8");
const css = `${viewCss}\n${foodCss}`;
const estimate = {
  dishName: "Example plate",
  approx: true as const,
  totalCarbs: 12,
  items: [{ name: "Pear", carbs: 12, confidence: "low" as const, approx: true as const }],
};
describe("capture and estimate theme matrix", () => {
  for (const mode of ["light", "dark"])
    for (const accent of ["olive", "plum", "sea", "forest", "garnet"])
      for (const width of [360, 1280]) {
        it(`${mode} ${accent} at ${width}px`, () => {
          const source =
            mode === "dark"
              ? tokens.slice(tokens.indexOf("@media"))
              : tokens.slice(0, tokens.indexOf("@media"));
          const palette = new RegExp(`\\[data-accent="${accent}"\\] \\{([^}]+)\\}`).exec(
            source,
          )?.[1];
          expect(palette).toBeDefined();
          const html = renderToStaticMarkup(
            <NextIntlClientProvider locale="en" messages={messages}>
              <div data-accent={accent} style={{ width }}>
                <PhotoTile
                  variant="capture"
                  verified={false}
                  title="Something else?"
                  subtitle="Take a photo"
                />
                <EstimateView
                  estimate={estimate}
                  photoDataUrl="data:image/jpeg;base64,YWJj"
                  carers={["Rowan"]}
                  locale="en"
                  simple
                  onBack={() => undefined}
                  onAsk={() => undefined}
                />
              </div>
            </NextIntlClientProvider>,
          );
          expect(html).toContain("A guess · not checked");
          expect(html).toContain("Ask an adult");
          const variables = [...new Set(css.match(/var\(--[^)]+\)/g))].sort();
          expect({ palette, mode, accent, width, variables }).toMatchSnapshot();
        });
      }
  it("uses token colors, 220px photo, 84px simple action and terracotta badge in both themes", () => {
    for (const value of [
      "height: 220px",
      "min-height: 84px",
      "border-radius: 22px",
      "var(--unverified-fg)",
      "var(--unverified-bg)",
      "font-size: 30px",
      "@media (prefers-color-scheme: dark)",
    ])
      expect(viewCss).toContain(value);
    expect(foodCss).toContain("3px dashed var(--hairline-strong)");
  });
});

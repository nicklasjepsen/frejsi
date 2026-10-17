import "@testing-library/jest-dom/vitest";

import { readFileSync } from "node:fs";
import path from "node:path";

import { FoodCategory, MealSymbol } from "@frejsi/shared/schemas/food";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import daNames from "../../../messages/da/foodCategory.json";
import enNames from "../../../messages/en/foodCategory.json";

import { FOOD_SYMBOL_PATHS, FoodSymbol, symbolPaths } from "./FoodSymbol";

const sheet = readFileSync(
  path.resolve(import.meta.dirname, "../../../../docs/design/food-symbols.md"),
  "utf8",
);

afterEach(cleanup);

describe("FoodSymbol (v0.6.0 plan §7, decision 4)", () => {
  it.each(MealSymbol.options)("draws %s as one inline SVG under the icon rules", (symbol) => {
    const { container } = render(<FoodSymbol symbol={symbol} />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(container.querySelectorAll("svg")).toHaveLength(1);
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("viewBox", "0 0 24 24");
    expect(svg).toHaveAttribute("stroke", "currentColor");
    expect(svg).toHaveAttribute("fill", "none");
    expect(svg).toHaveAttribute("stroke-linecap", "round");
    expect(svg).toHaveAttribute("stroke-linejoin", "round");
    expect(svg).toHaveAttribute("data-testid", "food-symbol");
    expect(svg).toHaveAttribute("data-symbol", symbol);
    expect(svg?.querySelectorAll("path").length).toBeGreaterThan(0);
  });

  it("has eleven values: the ten categories and the apple again for unknown", () => {
    expect(MealSymbol.options).toHaveLength(11);
    expect(Object.keys(FOOD_SYMBOL_PATHS).sort()).toEqual([...FoodCategory.options].sort());
    expect(symbolPaths("unknown")).toEqual(symbolPaths("fruit"));
    const drawings = new Set(FoodCategory.options.map((c) => symbolPaths(c).join(" ")));
    expect(drawings.size).toBe(FoodCategory.options.length);
  });

  it("takes a size in px, and an x/y position when nested inside a chart's SVG", () => {
    const { container } = render(<FoodSymbol symbol="bread" size={12} x={40} y={3.5} />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("width", "12");
    expect(svg).toHaveAttribute("height", "12");
    expect(svg).toHaveAttribute("x", "40");
    expect(svg).toHaveAttribute("y", "3.5");
    const plain = render(<FoodSymbol symbol="bread" />).container.querySelector("svg");
    expect(plain).toHaveAttribute("width", "20");
    expect(plain).not.toHaveAttribute("x");
  });
});

describe("docs/design/food-symbols.md (plan §8: the symbol sheet ships with the drawings)", () => {
  it("names every FoodCategory and unknown, in Danish and English, with the drawing as coded", () => {
    for (const symbol of MealSymbol.options) {
      expect(sheet, symbol).toMatch(new RegExp(`^### \`${symbol}\``, "m"));
      for (const d of symbolPaths(symbol)) expect(sheet, `${symbol} path`).toContain(d);
    }
    for (const category of FoodCategory.options) {
      expect(sheet, `${category} da`).toContain(daNames.names[category]);
      expect(sheet, `${category} en`).toContain(enNames.names[category]);
    }
  });

  it("lists the sizes the app draws them at", () => {
    for (const size of ["8 px", "12 px", "16 px", "18 px", "20 px", "24 px"])
      expect(sheet).toContain(size);
  });
});

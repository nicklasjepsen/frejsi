import type { FoodCategory, MealSymbol } from "@frejsi/shared/schemas/food";

/**
 * The ten food symbols and the apple again for `unknown` (v0.6.0 plan §7, decision 4): drawn in
 * code under the `icons` rules of tokens.json (inline SVG, stroke `currentColor`, round caps and
 * joins, a 24-unit grid), legible at 12 px on the phone's curve. `docs/design/food-symbols.md` is
 * the sheet of the same drawings; a later design pass replaces these paths and that sheet
 * together, nothing else.
 */
export const FOOD_SYMBOL_PATHS: Record<FoodCategory, readonly string[]> = {
  // A loaf: the rounded top, the flat base and three cuts across it.
  bread: [
    "M4 15.5a4.5 4.5 0 0 1 4.5-4.5h7a4.5 4.5 0 0 1 4.5 4.5V17H4v-1.5Z",
    "M9 13l-1.5 2.5M13 13l-1.5 2.5M17 13l-1.5 2.5",
  ],
  // An apple: the body with its dip at the top, and the stem.
  fruit: [
    "M12 8c-1.5-1.5-4.5-1.5-5.8 1.3C4.5 13 6.5 18.5 9.2 20c1 .5 1.8.2 2.8 0 1 .2 1.8.5 2.8 0 2.7-1.5 4.7-7 3-10.7C16.5 6.5 13.5 6.5 12 8Z",
    "M12 8c0-1.8.8-3 2.5-3.8",
  ],
  // A carrot: the tapered root pointing down-left, two leaves at the top.
  vegetables: [
    "M15.5 8.5c2 2 1.5 4.5-.5 6.5l-7 6-4-4 6-7c2-2 4.5-2.5 6.5-.5Z",
    "M15.5 8.5l2-4M15.5 8.5l4-2",
  ],
  // A glass of milk: the tapered glass and the level of the milk.
  dairy: ["M7 4h10l-1.2 16H8.2L7 4Z", "M7.6 10h8.8"],
  // A bowl with a fork standing in it.
  starch: ["M4 12h16a8 8 0 0 1-16 0Z", "M8.5 4v6M7 4v3a1.5 1.5 0 0 0 3 0V4"],
  // A drumstick: the meat and the bone.
  protein: [
    "M13 4.5a5 5 0 0 1 6.5 6.5L13 17.5 6.5 11 13 4.5Z",
    "M6.5 11l-2 2a1.8 1.8 0 1 0 2.5 2.5l2-2",
  ],
  // A lollipop: the round sweet with its swirl and the stick.
  sweets: [
    "M14.5 12a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z",
    "M10 9.5a2.5 2.5 0 0 0-2.5 2.5",
    "M13.2 15.2 19 21",
  ],
  // A pretzel: the knot with the two strands crossing.
  snack: [
    "M12 10.2C10.8 8.6 9.6 8 8.2 8 5.9 8 4 9.8 4 12c0 2.4 1.8 4 4 4h8c2.2 0 4-1.6 4-4 0-2.2-1.9-4-4.2-4-1.4 0-2.6.6-3.8 2.2Z",
    "M8 16l4-5.8M16 16l-4-5.8",
  ],
  // A cup with a straw.
  drink: ["M6 8h12l-1.2 12H7.2L6 8Z", "M9.5 8l4-5.5"],
  // A plate: the rim and the well.
  mixed: ["M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z", "M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z"],
};

/** The paths of a symbol; `unknown` is the apple (plan §7). */
export function symbolPaths(symbol: MealSymbol): readonly string[] {
  return FOOD_SYMBOL_PATHS[symbol === "unknown" ? "fruit" : symbol];
}

export interface FoodSymbolProps {
  symbol: MealSymbol;
  /** Width and height in px (or in the parent SVG's units when nested). */
  size?: number;
  /** Set when the symbol is nested inside another SVG, as the charts draw it. */
  x?: number;
  y?: number;
  strokeWidth?: number;
  className?: string;
}

/**
 * One inline SVG, always `aria-hidden`: the element around it carries the name when one is due
 * (a chart's tap target says "Måltid, Brød, kl. 12:10"; a library row names the category). With
 * `x`/`y` it is a nested `<svg>` inside a chart, scaled by its own viewBox.
 */
export function FoodSymbol({
  symbol,
  size = 20,
  x,
  y,
  strokeWidth = 1.8,
  className,
}: FoodSymbolProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      {...(x !== undefined ? { x } : {})}
      {...(y !== undefined ? { y } : {})}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-testid="food-symbol"
      data-symbol={symbol}
      {...(className ? { className } : {})}
    >
      {symbolPaths(symbol).map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

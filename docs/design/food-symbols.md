# Food symbols

The symbol a meal carries on the glucose curve (v0.6.0 plan §7). It is derived once, when the meal is saved (`mealSymbol()` in `shared/src/meals/symbol.ts`), stored on the meal and never recomputed from the library, so a later edit of a food's category leaves every past day as it was.

The drawings were made in code (plan decision 4) under the `icons` rules of `tokens.json`: inline SVG on a 24-unit grid, `fill="none"`, `stroke="currentColor"`, round caps and joins, stroke width 1.8 (2.2 at the chart sizes, 2 on the simpleMode card). The source of truth is `web/src/components/food/FoodSymbol.tsx`; a test asserts that this sheet lists every symbol with the same path data. A later Claude Design pass replaces the paths there and here, nothing else.

## Where and how large

| Place                                             | Size                                    | Colour          |
| ------------------------------------------------- | --------------------------------------- | --------------- |
| Day curve, phone sizes (Historik-Telefon)         | 12 px                                   | `--meal-marker` |
| Day curve, desktop (Nu-Desktop, Historik-Desktop) | 16 px                                   | `--meal-marker` |
| Meal curve, above the plot                        | 12 px phone, 16 px desktop              | `--meal-marker` |
| Week tile, in place of the meal dot               | 8 px                                    | `--meal-marker` |
| Chart legend, the meal entry (the plate)          | 10 px (meal legend), 12 px (day legend) | `--meal-marker` |
| Library rows, before the name                     | 20 px phone, 24 px desktop              | `--text`        |
| Category chips of the food form                   | 18 px                                   | `--text`        |
| The simpleMode last-meal card                     | 32 px                                   | `--meal-marker` |

The symbol is always `aria-hidden`; the element around it carries the name. On the curve the tap target says "Måltid, Brød, kl. 12:10" ("Måltid kl. 12:10" for `unknown`); in the library the row names the category.

Meals are always terracotta: the symbol takes `--meal-marker`, as the meal line does. Nothing else on the curve has that colour; the symptom marker (a diamond on the time axis) is drawn in `--text`.

## The eleven symbols

`MealSymbol` is the ten `FoodCategory` values plus `unknown`. Names are the `foodCategory.names.*` messages.

### `bread`

A loaf: the rounded top, the flat base and three cuts across it.

- da: Brød · en: Bread
- `M4 15.5a4.5 4.5 0 0 1 4.5-4.5h7a4.5 4.5 0 0 1 4.5 4.5V17H4v-1.5Z`
- `M9 13l-1.5 2.5M13 13l-1.5 2.5M17 13l-1.5 2.5`

### `fruit`

An apple: the body with its dip at the top, and the stem.

- da: Frugt · en: Fruit
- `M12 8c-1.5-1.5-4.5-1.5-5.8 1.3C4.5 13 6.5 18.5 9.2 20c1 .5 1.8.2 2.8 0 1 .2 1.8.5 2.8 0 2.7-1.5 4.7-7 3-10.7C16.5 6.5 13.5 6.5 12 8Z`
- `M12 8c0-1.8.8-3 2.5-3.8`

### `vegetables`

A carrot: the tapered root pointing down-left, two leaves at the top.

- da: Grønt · en: Vegetables
- `M15.5 8.5c2 2 1.5 4.5-.5 6.5l-7 6-4-4 6-7c2-2 4.5-2.5 6.5-.5Z`
- `M15.5 8.5l2-4M15.5 8.5l4-2`

### `dairy`

A glass of milk: the tapered glass and the level of the milk.

- da: Mælk og ost · en: Milk and cheese
- `M7 4h10l-1.2 16H8.2L7 4Z`
- `M7.6 10h8.8`

### `starch`

A bowl with a fork standing in it.

- da: Pasta, ris og kartofler · en: Pasta, rice and potato
- `M4 12h16a8 8 0 0 1-16 0Z`
- `M8.5 4v6M7 4v3a1.5 1.5 0 0 0 3 0V4`

### `protein`

A drumstick: the meat and the bone.

- da: Kød, fisk og æg · en: Meat, fish and egg
- `M13 4.5a5 5 0 0 1 6.5 6.5L13 17.5 6.5 11 13 4.5Z`
- `M6.5 11l-2 2a1.8 1.8 0 1 0 2.5 2.5l2-2`

### `sweets`

A lollipop: the round sweet with its swirl and the stick.

- da: Slik og kage · en: Sweets and cake
- `M14.5 12a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z`
- `M10 9.5a2.5 2.5 0 0 0-2.5 2.5`
- `M13.2 15.2 19 21`

### `snack`

A pretzel: the knot with the two strands crossing.

- da: Snacks · en: Snacks
- `M12 10.2C10.8 8.6 9.6 8 8.2 8 5.9 8 4 9.8 4 12c0 2.4 1.8 4 4 4h8c2.2 0 4-1.6 4-4 0-2.2-1.9-4-4.2-4-1.4 0-2.6.6-3.8 2.2Z`
- `M8 16l4-5.8M16 16l-4-5.8`

### `drink`

A cup with a straw.

- da: Drikke · en: Drinks
- `M6 8h12l-1.2 12H7.2L6 8Z`
- `M9.5 8l4-5.5`

### `mixed`

A plate: the rim and the well. Also the legend's meal entry.

- da: Blandet ret · en: Mixed dish
- `M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z`
- `M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z`

### `unknown`

The apple again: a meal whose dominant item has no category, or a meal from before v0.6.0. The tap target then says "Måltid kl. {time}" with no category.

- da: (no name; the chart says "Måltid") · en: (no name; the chart says "Meal")
- `M12 8c-1.5-1.5-4.5-1.5-5.8 1.3C4.5 13 6.5 18.5 9.2 20c1 .5 1.8.2 2.8 0 1 .2 1.8.5 2.8 0 2.7-1.5 4.7-7 3-10.7C16.5 6.5 13.5 6.5 12 8Z`
- `M12 8c0-1.8.8-3 2.5-3.8`

## Symbols next to each other

The symptom marker is not a food symbol: a 10 px diamond in `--text` on the time axis, `data-testid="symptom-marker"`. The bolus triangle (10 px, `--meal-bolus-marker`, apex up on the baseline) is unchanged. A test (`GlucoseChart.symptoms.test.tsx`) checks that the three are distinguishable at the phone sizes by shape, colour and test id.

## What the owner may change

Task 7 of the v0.6.0 plan asks the owner to accept or redraw these. Redrawing means replacing the path data in `FoodSymbol.tsx` and in this sheet; the names, sizes and colours stay.

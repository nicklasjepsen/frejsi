# Recipe parser data

Documented data files (CLAUDE.md: nothing Danish in code; Danish belongs in a message file or a
documented data file). They are read by `../jsonld.ts` and `../ingredients.ts`.

- `units.json`: the units an ingredient line may carry, in `da` and `en`. `unit` is the canonical
  form kept on the line; `aliases` are matched case-insensitively (a trailing full stop is
  ignored); `grams` is the weight of one unit where a unit has one (1 dl of water is 100 g; good
  enough for carbohydrates, decision 12). A unit without `grams` is countable: its grams come
  from the matched food's first portion.
- `staples.json`: ingredient names that resolve to 0 g carbohydrate without a lookup
  (`NO_CARB_STAPLES`, plan §6): water, salt, pepper, spices, herbs, oil, butter, vinegar, yeast,
  raising agents, stock, in `da` and `en`. `fillers` are words ignored around them ("lidt salt",
  "frisk basilikum", "salt og peber").
- `entities.json`: the named HTML entities a recipe page's text may carry (`&aelig;`, `&oslash;`,
  `&aring;` and the common ASCII ones); numeric entities are decoded by code.

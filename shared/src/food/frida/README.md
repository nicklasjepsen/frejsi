# Frida local food source

`FridaSource` implements `FoodSource` with `kind: "local"`. Enable it with
`FOOD_SOURCES=frida` (or `off,frida`). It never accesses the network or database;
barcode lookup returns `skipped`. Bundled data loads lazily once per process.
Tests inject a loader reading three fictional entries from a temporary JSON file.

Search folds names with the shared locale-independent Latin folding function,
requires every query word to be a substring, and returns the first ten matches
in numeric food-id order. The requested locale falls back to the other locale
only when its name is missing. Candidates contain a name, `frida:<id>`, available
carbohydrate per 100 g, the food category of the entry's Frida group
(`shared/src/food/category/frida-groups.ts`, every group mapped; v0.6.0), and no
barcode or portions. They carry no verification field; the space-copy service sets
`verified: false` until a human checks it. `byRef("frida:<id>")` answers one entry from
the dataset, so a pick's data and category come from here rather than from the client.

See [data/README.md](data/README.md) for dataset provenance, attribution, licence
and the exact refresh procedure. `pnpm --filter ./shared frida:import <csv>`
regenerates the committed JSON deterministically; an optional second argument
sets a temporary output path for verification. No runtime download or deployment
import is needed. `fixtures/frida/frida-excerpt.csv` uses fictional foods and
values in the projected DTU column layout, including deliberately different
available carbohydrate and carbohydrate-by-difference values.

Another local food database can sit alongside this plugin by implementing the
same interface and adding a configuration-controlled registry factory. Only this
plugin reads its bundled dataset; the CI boundary test checks that separation
and the absence of a network transport in the local plugin.

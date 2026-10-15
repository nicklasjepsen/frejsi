# Open Food Facts source

`OffSource` is a remote `FoodSource`. It takes `fetch`, `country`, `version`, an
optional barcode `locale` (defaults to `en`) and optional test rate limits.
Only `registry.ts` supplies the real fetch. No request runs at construction.

Configuration: `FOOD_SOURCES=off,frida` enables these plugins in that order;
missing/empty `FOOD_SOURCES` enables neither. `OFF_COUNTRY=dk` boosts Danish
products; another country code changes the preference without changing code.
`APP_VERSION` (or `NEXT_PUBLIC_APP_VERSION`, then `dev`) identifies the app.
`OFF_LANGUAGE=da` selects Danish barcode names; text search uses its `locale`
argument. Without a country the source queries the world host once.

- Product reads: `https://world.openfoodfacts.org/api/v2/product/<barcode>.json`.
  UPC-A is normalized to EAN-13. Status 0 (including HTTP 404) is an ordinary miss.
- Text: `https://<country>.openfoodfacts.org/cgi/search.pl`, with `search_terms`,
  `search_simple=1`, `action=process`, `json=1`, `page_size=10`, and `fields`.
  Fewer than five country rows triggers the world host. Country results precede
  world results, normalized codes deduplicate them, and only ten are returned.
- Fields: code, localized/default product name, brands, nutriments,
  serving_size, serving_quantity, serving_quantity_unit. The displayed name is
  `{localized name or default name}, {brands}` (brand suffix omitted if absent).
  Carbohydrates come only from `carbohydrates_100g`, rounded to one decimal.
  Missing/invalid carbohydrates stay null. A serving needs known carbohydrates
  and a mass in grams; volumes are never treated as grams. Portion carbs round
  half up to whole grams. Invalid products are omitted. Images are not requested.
- Every request sends `User-Agent: Frejsi/<version> (+https://github.com/nicklasjepsen/frejsi)`.
  Caller cancellation reaches fetch; 429/budget exhaustion returns `rate-limited`,
  cancellation `timeout`, and other request/response failures `error`.

The process shares token buckets between all default source instances: ten
search HTTP requests and **15 product reads** per minute. Country/world fallback
consumes two search tokens. Tokens refill continuously, concurrent reservations
are synchronous, and neither errors nor cancellations refund requests. The plan
originally specified 100 reads; [OFF's current API documentation](https://openfoodfacts.github.io/openfoodfacts-server/api/#rate-limits)
publishes 15 reads/minute/IP, so the source uses the tighter ceiling. Separate
processes sharing one public IP still share the upstream limit; 429 is handled.
Submit remote text searches explicitly, never for each keystroke.

[OFF API documentation](https://openfoodfacts.github.io/openfoodfacts-server/api/)
still supports v2 product reads and the legacy free-text endpoint required by
this lane. OFF data is ODbL with individual contents under DbCL; images have
separate CC BY-SA terms and are excluded. All plugin results are strict
`FoodCandidate`s with no `verified` property. The lookup/cache and space-copy
services create them with `verified: false`; a human verifies the space copy.

Tests serve only hand-written, recorded response shapes from
`fixtures/open-food-facts/`. Products/brands are fictional; `20…` barcodes are
restricted circulation examples. No test contacts OFF. The adapter boundary test
runs in CI and rejects vendor hosts elsewhere in application source.

For a new remote plugin, implement `FoodSource`, inject its transport, keep the
vendor mapping inside its directory, add fixtures and append a registry factory.
Registration never implicitly enables a plugin.

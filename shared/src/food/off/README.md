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
  If the optional world request fails, existing country matches are retained.
- Fields: code, localized/default product name, brands, categories_tags, nutriments,
  serving_size, serving_quantity, serving_quantity_unit. The food category (v0.6.0) is
  the most specific `categories_tags` entry the table in `shared/src/food/category/off-tags.ts`
  knows (OFF lists tags general to specific); a product without a known tag has none. The displayed name is
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

## Contributing a correction (`OffContributor`)

`OffContributor` is the `FoodContributor` for OFF: it sends a human-approved
correction of the carbohydrates per 100 g and the serving size back to Open Food
Facts. **It is never automatic.** The only caller of `.contribute(` is the
contributions service in `web/src/lib/contributions/`, behind an unticked
checkbox in the edit form, for a food whose `origin` is `off`. A boundary test
(`lint-boundaries.test.ts`) fails if anything else in `shared/` calls it. It
writes nothing to `Food` and imports no Prisma client or repository.

- Endpoint: `POST https://<host>/cgi/product_jqm2.pl`, `application/x-www-form-urlencoded`.
  The host is the constructor option `host`, default `world.openfoodfacts.org`;
  `registry.ts` passes `OFF_CONTRIBUTE_HOST` through when set. The host and the
  path are literals only in this folder.
- Fields: `code` (barcode), `user_id`, `password` (the deployment's OFF account),
  `app_name=Frejsi`, `app_version`, `app_uuid=<appRef>` (a pseudonym, never a user
  or space id), `nutrition_data_per=100g`, `nutriment_carbohydrates`,
  `nutriment_carbohydrates_unit=g`, `serving_size=<grams> g` when given, and
  `comment=Correction from Frejsi`. The carbohydrate fields are left out when no
  value was corrected. No `product_name` is ever sent; nor a photo or a person.
  The `User-Agent` is the same as the read side's.
- Known limit: OFF applies `nutrition_data_per` to every nutrient of the product. For
  a product stored per serving, resending only carbohydrates per 100 g can change how
  its other nutrients read. The plan fixes `100g` (decision 9, and the acceptance test
  asserts it); a later change could read the product first and keep its basis.
- Result: `{ status: 1 }` is `ok`; `{ status: 0 }` whose `status_verbose` names a
  user, login or password is `bad-credentials`; any other `status: 0` is
  `rejected`; HTTP 429 or the local bucket is `rate-limited`; a network error, any
  other HTTP failure, an unreadable body or the 10 s timeout is `error`. The
  caller's `AbortSignal` reaches `fetch`.
- Rate limit: ten writes a minute per process (`OffRateLimits.write`); the 11th
  returns `rate-limited` without a call.
- Staging for a first try: set `OFF_CONTRIBUTE_HOST=world.openfoodfacts.net`
  with an account made on that host. The staging host sits behind HTTP basic
  authentication `off` / `off`, which the contributor adds to the request
  itself. Staging data is wiped now and then; use it before pointing at production.
- Secrets: the account is `OFF_CONTRIBUTE_USER` / `OFF_CONTRIBUTE_PASSWORD`, read
  once in `registry.ts` and given to the constructor. Neither the password nor the
  barcode reaches a log line, an error message or a thrown value: every failure
  is a status. A deployment with no account has no contributor
  (`foodContributors({})` is empty), so no screen offers the checkbox.
- Dev and e2e: `FAKE_FOOD_CONTRIBUTOR=1` registers `FakeFoodContributor` under
  `off`; it answers from a script and records every correction. It may be imported
  only from tests, `seed.ts`, `cli.ts` and `registry.ts`.

For a new contributor (say `usda`), implement `FoodContributor`, keep the vendor
endpoint inside its own directory, inject `fetch`, add write fixtures and
register it in `foodContributors(env)`; configuration enables it, never code.
Fixtures: `fixtures/open-food-facts/write-*.json`. No test writes to OFF.

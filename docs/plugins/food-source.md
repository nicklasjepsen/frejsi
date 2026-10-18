# Writing a food source

A food source is where Frejsi looks up carbohydrates for a country or a dataset. Open Food Facts and
the bundled DTU Frida dataset are the two that exist; the roadmap names `usda`, `bls` (Germany) and
`matvaretabellen` (Norway) as the next ones, and this guide uses `usda` as its running example. Read
[architecture.md](../architecture.md) first for the shape of the whole, and
[CONTRIBUTING.md](../../CONTRIBUTING.md) for how a pull request is reviewed.

In short: a source is one folder, one appended registry line, one setting, a fixture set, a README
and two message keys. It never touches the database; the library, the cache and the verification
flow are the app's.

## The contract

`FoodSource` is in `shared/src/food/types.ts`:

- `id`: a short lower-case id, 1 to 20 characters of `a-z`, `0-9` and `-`, starting with a letter
  (`FoodOrigin` in `shared/src/schemas/food.ts`). `library` and `cache` are reserved. It is stored on
  every food it returns as `origin`, so choose it once.
- `kind`: `remote` if it calls a network, `local` if the data ships with the app (Frida).
- `search(q, locale, signal)` and `byBarcode(barcode, signal)`: return `{ status, candidates }`
  where `status` is `ok`, `timeout`, `error`, `rate-limited` or `skipped`. Never throw for a failed
  lookup; return the status. Honour the `AbortSignal`: a slow source must not hold up the others.
- A candidate is a `FoodCandidate`: a `name`, an `origin` equal to your `id`, a `sourceRef` that is
  unique and stable inside your source (`usda:170393`), `carbsPer100g` to one decimal (or portions),
  and optionally a `barcode` and `portions`. A candidate has no `verified` field. Whatever you return
  reaches the library with `verified: false` until a person ticks it; do not try to mark it.
- A source returns carbohydrates and names. Nothing about insulin, ever: Frejsi never computes,
  suggests or lets anyone enter it, and the one place it shows what a pump delivered (pump
  history) is nowhere near a food source.

## The steps

1. **Open an issue** with the `plugin:food-source` label saying which dataset and which licence it is
   under. A dataset that cannot be redistributed must be fetched at run time, not bundled.
2. **Create the folder** `shared/src/food/<id>/` with:
   - `source.ts`: `class UsdaSource implements FoodSource`. Take `fetch` as a constructor argument and
     never reach for the global one inside the class, so tests can serve fixtures. A `local` source
     takes a loader instead, as `shared/src/food/frida/source.ts` does.
   - `map.ts`: pure functions turning the vendor's response into `FoodCandidate`s, parsed through
     `FoodCandidate.safeParse` that returns `null` for a bad row, so one malformed row is dropped and
     never aborts the lookup or reaches the library. See `shared/src/food/off/map.ts`.
   - `README.md`: what the dataset is, its licence and attribution, the endpoints or files used, and
     what the plugin deliberately ignores. See `shared/src/food/off/README.md`.
   - `source.test.ts` and `lint-boundaries.test.ts` (below).
3. **Append one registry line** to `shared/src/food/registry.ts`:

   ```ts
   registerFoodSource("usda", (env) => new UsdaSource({ fetch: globalThis.fetch, version: env.APP_VERSION ?? "dev" }));
   ```

   This is the only place the real `fetch` is handed to a food source. Registering a plugin never
   switches it on.
4. **Read your settings from `env`** in that factory, and add each new name to `.env.example` with an
   empty value or a `<placeholder>`. A test (`shared/src/env-example.test.ts`) fails if a variable the
   code reads is missing from the file, or the file names one nothing reads. A key for the vendor is
   a Key Vault secret and an app setting, written by `infra/deploy.sh` only when present; say so in
   your README and in the pull request, and add the row to `docs/deploy-your-own.md`.
5. **Switch it on** with `FOOD_SOURCES`: `FOOD_SOURCES=off,usda`. In a deployment that is the
   repository variable of the same name ([deploy-your-own.md](../deploy-your-own.md)).
6. **Write the fixtures** in `fixtures/<id>/`: hand-written responses in the vendor's documented
   shape, with fictional foods and round numbers, never recorded from a real account or a real
   person's data. Cover at least a hit, an empty result, a missing carbohydrate value, a rate limit
   or error status, and, if the source has barcodes, a GS1 restricted-circulation code (`20...`).
   Add a `README.md` there saying the files are hand-written and not checked against a live site.
7. **Test against the fixtures**, with no network: `source.test.ts` serves the fixture files by URL
   through a recording `fetch` and asserts the candidates, every status, and that the abort signal is
   honoured. Add a registry test like `shared/src/food/off/registry.test.ts`: the plugin is
   registered but `foodSources({})` is empty, and `FOOD_SOURCES=<id>` returns it.
8. **Add a boundary test** `shared/src/food/<id>/lint-boundaries.test.ts`, following
   `shared/src/food/off/lint-boundaries.test.ts`: the vendor's host appears nowhere outside your
   folder, and a `local` source contains no network code at all.
9. **Add two message keys**, in both languages in the same commit: the label a food shows
   (`origin.<id>` in `web/messages/da/library.json` and `web/messages/en/library.json`) and its name
   (`sourceName.<id>`). Without them a food says "From <id>"; with them it reads naturally. Danish
   copy reads like a kind nurse, plain and unhurried.
10. **Optional: a contributor.** If the vendor takes corrections back, implement `FoodContributor`
    (`shared/src/food/off/contribute.ts` is the example) and append it to `foodContributors(env)` in
    the same registry. It is called only from `web/src/lib/contributions/`, only after a person ticks
    a box, and a deployment without the account has no box.

## Rules your plugin keeps

- Everything it returns is `verified: false`; `simpleMode` shows verified foods only.
- No secret outside the factory that reads it; none in a log, an error message or a fixture.
- No personal data in logs: use `log` from `shared/src/log.ts`, which takes an allow-list of keys.
- Nothing Danish hard-coded: a locale, country or language comes from `env` or from the `locale`
  argument. `shared/src/i18n-literals.test.ts` and the Danish-letters lint enforce it.
- Nothing that computes, suggests or lets anyone enter insulin: no input, calculation, ratio,
  correction or suggestion, in code, README, fixtures or messages.
- The vendor is never named outside the plugin's folder, its fixtures, its two message keys and the
  registry line.

## Pull request checklist

- [ ] An issue with the `plugin:food-source` label, linked with `Closes #n`
- [ ] `shared/src/food/<id>/` with source, map, README, tests and boundary test
- [ ] One appended line in `shared/src/food/registry.ts`; no existing line changed
- [ ] New settings in `.env.example`; `pnpm -r test` passes the env test
- [ ] Fixtures in `fixtures/<id>/`, fictional, with a README
- [ ] Two message keys, `da` and `en`
- [ ] Licence and attribution in the plugin README
- [ ] `## Docs` lists the documentation paths changed (`.env.example` and `docs/deploy-your-own.md`
      for a new setting or secret), or `None needed: <concrete reason>`
- [ ] `pnpm -r typecheck && pnpm -r lint && pnpm -r test` is green
- [ ] Commits signed off (`git commit -s`)

# Architecture

A short map of how Frejsi is put together, for someone who is going to read the code or write a
plugin. It describes what the code does today. The original design spec
([docs/superpowers/specs/2026-10-14-frejsi-design.md](superpowers/specs/2026-10-14-frejsi-design.md))
is the history; [CLAUDE.md](../CLAUDE.md) holds the hard rules; [deploy-your-own.md](deploy-your-own.md)
is how to run a copy.

## The packages

pnpm monorepo. The dependency direction is one way: `web` and `poller` depend on `shared`, never the
reverse, and `web` and `poller` never import each other.

| Package   | What it is                                                                                                                                                    | Runs on                      |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `web/`    | Next.js App Router: the screens and the API routes under `web/src/app/api/`                                                                                   | Azure Static Web Apps        |
| `poller/` | Node 22 Azure Functions: the timer that fetches glucose every five minutes, the `source-connect` HTTP function, the food enrichment and weekly insight timers | Azure Functions, Consumption |
| `shared/` | Zod schemas (the contract between web, poller and AI output), Prisma, and the domain logic: sources, events, statistics, photos                               | imported by both             |

`infra/` holds the Bicep and the deployment script ([infra/README.md](../infra/README.md)); `fixtures/`
holds hand-written, fictional responses of every external service; `evals/` holds the AI checks.

## The data flow

```
glucose source ──every 5 min──▶ poller ──▶ readings table ──▶ emit("reading") ──▶ Web PubSub ──▶ phones
(Dexcom Share, Nightscout)                                          ▲
phone ──▶ web (Next.js) ──▶ API routes ──▶ database ──▶ emit(...) ──┘
                              │
                              ├──▶ food sources (Open Food Facts, Frida), cached in the database
                              └──▶ an AI provider, only on an explicit user action
```

The `poll` timer asks each space's glucose source for the readings since the last stored one, stores
them, and emits a `reading` event. Nothing is fetched for a space whose source is `manual`: typed-in
finger-prick values come in through the web API instead and take the same path from there. The web
app and the poller share one database; Web PubSub carries live updates and the `events` table is the
source of truth, so a client that missed a push catches up by asking for events since its last
sequence number.

## `emit()` and the two groups

Every write to space data goes through `emit(spaceId, type, payload)` in
`shared/src/events/emit.ts`. In one transaction it increments the space's sequence number and writes
the row to the `events` table, then publishes the event to Web PubSub. A lint rule
(`eslint.config.js`) forbids writing the `event` table anywhere else.

Events go to one of two Web PubSub groups per space:

- `space-<id>`: every member, viewers included. Meals, foods, settings, people.
- `space-<id>-glucose`: owners and carers only. The `reading` and `readings.imported` events, and
  since v0.7.0 the pump record's `pump.imported`, `pump.meals` and `pump.status`
  (`GLUCOSE_EVENT_TYPES` in `shared/src/schemas/events.ts`), so a viewer never learns that pump
  data exists or arrived.

A client token carries only the user id. The hub's `connect` handler (`web/src/app/api/pubsub/`) looks
up the member's current role when a socket opens and joins exactly the groups that role allows, so a
viewer is never in the glucose group whatever token they hold. A `viewer` never receives glucose; this
is enforced in the API, not the component.

## The three plugin interfaces

Everything outside the app that Frejsi talks to sits behind one of three interfaces. Each has a
registry that decides what is switched on, and a fake for tests.

### `GlucoseSource`: where readings come from

- The interface: `shared/src/glucose/types.ts`. `fetchSince(since)` returns readings, oldest first,
  each with its timestamp; `probe()` checks a credential and returns `ok`, `bad-credentials` or
  `unreachable`. `source-connect` follows an `ok` with `fetchSince` over the last day and reports
  the count, so a login that works but has nothing to read (a follower's) is caught at connect time.
- Adapters: `shared/src/glucose/dexcom-share/` and `shared/src/glucose/nightscout/`. `manual` has no
  adapter on purpose.
- The registry: the `GlucoseSourceType` enum and the `GlucoseSourceConfig` variants in
  `shared/src/schemas/glucose.ts`; the poller builds an adapter from a stored config in
  `poller/src/sources.ts` (`createSourceFactory`) and the connect function does the same in
  `poller/src/source-connect-handler.ts` (`ADAPTERS`, typed over every polled type, so a new type
  without an adapter fails to compile).
- Settings: the credential is stored in Key Vault as a version of `glucose-<spaceId>` through the
  `Secrets` interface (`shared/src/secrets/types.ts`); the database holds only `{ type, secretRef }`,
  where `secretRef` is `glucose-<spaceId>/<version>`, the one version that connect wrote, so the
  poller reads the credential the config was saved with and a failed or racing connect cannot pair
  a credential with another request's region (#78). The
  Settings screen renders one `SourceCard` per `GlucoseSourceType` value
  (`web/src/components/settings/SourceCards.tsx`).
- The fake: `shared/src/glucose/fake.ts`, chosen with `FAKE_GLUCOSE_SOURCE=1`.

Glucose sources are read-only: Frejsi never writes to a CGM or a glucose service, and each adapter
calls only the endpoints on its own allow-list.

### `PumpSource`: where the pump record comes from (v0.7.0)

- The interface: `shared/src/pump/types.ts`. `fetchBolusesSince(since)` returns the boluses the pump
  recorded, oldest first, each a `PumpBolus` (`shared/src/schemas/pump.ts`): the record's own
  `sourceId`, its `ts`, the delivered `units`, the `kind` (`standard`, `extended`, `automatic`,
  `other`) and the calculator's `carbs`. `probe()` is the same as a glucose source's. Read-only, like
  a glucose source; the cycle knows the interface, not the vendor.
- The data model: `PumpBolus` (unique on `(spaceId, sourceId)`, so re-polling adds nothing;
  `mealDismissed` when a carer deleted the pump meal made from it), `Space.pumpSource`
  (`PumpSourceConfig`: the type, the secret reference `pump-<spaceId>/<version>`, who connected it),
  `Space.pumpStatus`, `Space.pumpFailures`, `Space.lastPumpAt`, and on `Meal` the `pumpBolusId` the
  matcher gave it and `source = "pump"` while it is an untouched meal made from pump carbs.
- The rules: `matchBoluses` and `diffLinks` in `shared/src/pump/match.ts` pair each meal with at
  most one standard or extended bolus from 45 minutes before to 30 after, nearest first; an
  automatic bolus never attaches. `formatUnits` in `shared/src/pump/units.ts` is the only unit
  display ("2,4 E" / "2.4 U").
- Who sees it: owners and carers outside simpleMode, through the meal views (`MealView.bolusUnits`,
  `pumpCarbs`, `pumpBolusId`, `fromPump`) and the pump route. `DayMealView`, the viewer's meal,
  carries none of it; the three `pump.*` events are glucose-group events; nothing of the pump record
  enters an AI input (`shared/src/dosing.test.ts` walks `InsightInput` and `WeekInsightInput`).

### `FoodSource` and `FoodContributor`: where foods come from

- The interfaces: `shared/src/food/types.ts`. A `FoodSource` has an `id`, a `kind` (`remote` or
  `local`), `search` and `byBarcode`. A `FoodContributor` sends a human-approved correction back to
  the source a food came from.
- Plugins: `shared/src/food/off/` (Open Food Facts, a source and a contributor) and
  `shared/src/food/frida/` (a bundled dataset, `local`).
- The registries: `shared/src/food/registry.ts`. `registerFoodSource(id, factory)` is one appended
  line per plugin; `foodSources(env)` returns the ones named in `FOOD_SOURCES`, and registering a
  plugin never switches it on. `foodContributors(env)` returns a contributor only when the
  deployment has credentials for it, so a screen never offers a correction that cannot be sent.
- The fakes: `shared/src/food/fake.ts` and `shared/src/food/fake-contributor.ts`
  (`FAKE_FOOD_CONTRIBUTOR=1`).

### `AiProvider`: where the optional AI help comes from

- The interface: `shared/src/ai/types.ts`. A provider declares what it can do (`complete`, `vision`,
  `embed`); the use cases (`shared/src/ai/parse/`, `estimate/`, `insight/`, `recipe/`, `search/`)
  are written against it.
- The recipe reader (`shared/src/ai/recipe/`, v0.6.0) is a user of both interfaces: a
  `schema.org/Recipe` page is read from its JSON-LD with no provider at all, pasted text or a fetched
  page goes to `complete` and a photo to `vision`, and every ingredient line is then resolved through
  `lookup()` (`shared/src/food/lookup.ts`) in the normal order, library first, then the cache and the
  `FoodSource` plugins. With AI off the URL way still works and the other two answer `ai-disabled`.
- Adapters: `shared/src/ai/anthropic/`, `azure-openai/`, `ollama/` and `voyage/` (embeddings).
- The registry: `aiProviders(env)` in `shared/src/ai/registry.ts` builds only the providers whose
  settings are present. `shared/src/ai/capped.ts` wraps each one with the per-space daily cap.
- The fake: `shared/src/ai/fake.ts`, chosen with `FAKE_AI_PROVIDER=1`.

## Configuration, not code

The things a different country or a different household changes are settings, and every one is listed
in [.env.example](../.env.example) (a test keeps that file and the code equal):

| Setting                                                             | What it decides                                                                                                                   |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `DEFAULT_LOCALE`                                                    | The language a visitor with no preference gets: `da` or `en`.                                                                     |
| `FOOD_SOURCES`                                                      | Which food plugins are switched on, as a comma-separated list of ids.                                                             |
| `OFF_COUNTRY`                                                       | Which country's Open Food Facts products are preferred; empty means the whole world.                                              |
| `OFF_CONTRIBUTE_HOST`                                               | Which Open Food Facts host receives corrections; empty is production, `world.openfoodfacts.net` is the staging host to try first. |
| `AI_DAILY_CAP`, `AI_EMBED_DAILY_CAP`, `AI_EMBED_BACKFILL_DAILY_CAP` | The per-space daily limits on AI calls.                                                                                           |

In a deployment the release pipeline writes `DEFAULT_LOCALE`, `FOOD_SOURCES`, `OFF_COUNTRY` and
`OFF_CONTRIBUTE_HOST` from repository variables of the same names
([deploy-your-own.md](deploy-your-own.md)). The AI caps are read from the process environment and
the pipeline does not set them, so a deployment runs on the defaults (50, 500 and 2000) unless
`infra/deploy.sh` is changed to write them.

### The only Danish defaults, each behind a setting

The product is Danish-first; the code is not. A test (`shared/src/i18n-literals.test.ts`) fails on a
Danish default (`= "da"`, `?? "da"`, `|| "da"`, `.default("da")`, a ternary that ends in `"da"`, and
the same for `"dk"`) and on `"Europe/Copenhagen"` anywhere in `web/src`, `poller/src` and
`shared/src`, outside these places:

- `shared/src/schemas/`: the `Locale` enum is a list, not a default.
- `shared/prisma/`: the `User.locale` column's `@default("da")`.
- `web/src/lib/i18n/`: where `DEFAULT_LOCALE` is read and `da` is the documented fallback.
- `shared/src/food/off/`: the `OFF_COUNTRY` fallback.
- `.env.example`: an example value is not a default.

A lint rule (`frejsi/boundaries/english-in-shared-and-poller`, next to the one for `web/src`) also
keeps the letters æ, ø and å out of string literals in `shared/src` and `poller/src`, apart from tests,
the Frida dataset (`shared/src/food/frida/data/`), the search fold table (`shared/src/food/search.ts`),
the dosing word list (`shared/src/dosing-vocabulary.ts`, `shared/src/ai/guard.ts`), the AI prompts
(`shared/src/ai/**/prompt*.ts`, `shared/src/ai/insight/meal.ts` and `week.ts`) and the Danish column
names of a Dexcom Clarity export (`shared/src/glucose/import/clarity.ts`). UI strings live in
`web/messages/da/` and `web/messages/en/`.

## Fakes

Tests never call Dexcom, Nightscout, Open Food Facts or an AI provider. The adapters take their
`fetch` as a constructor argument and are tested against `fixtures/` served by URL; the real
`fetch` is handed to a glucose adapter only by `poller/src/sources.ts` and
`poller/src/source-connect-handler.ts`, and to a food plugin only by `shared/src/food/registry.ts`. For everything else there is an in-memory fake:
`FakeGlucoseSource`, `FakeFoodSource`, `FakeFoodContributor`, `FakeAiProvider`, `MemorySecrets`
(`shared/src/secrets/memory.ts`), `MemoryEventSink` (`shared/src/events/memory.ts`),
`MemoryPhotoStore` and `MemoryFoodRepository`. Production code never imports a fake; a lint rule
allows it only in tests, the seed (`web/scripts/seed.ts`) and the poller CLI (`poller/src/cli.ts`).

## The lint boundaries

`eslint.config.js` turns the architecture into errors, and each boundary has a test next to the code
that proves it on probe files (`shared/src/events/lint-boundaries.test.ts` and the
`lint-boundaries.test.ts` in each adapter folder). The ones a plugin author meets:

- Only `emit()` writes the `event` table.
- A vendor's host and protocol strings live in that vendor's adapter folder and nowhere else
  (the Dexcom host, the Nightscout paths and the `api-secret` header, the Open Food Facts write
  endpoint).
- The real `fetch` reaches a glucose adapter only from `poller/src/sources.ts` and
  `poller/src/source-connect-handler.ts`, and a glucose adapter has no code that writes to its
  provider.
- Fakes are imported only from tests, the seed and the CLI.
- Vendor SDKs are imported in one place each: Web PubSub in `shared/src/events/`, Key Vault in
  `shared/src/secrets/`, Application Insights in `shared/src/telemetry.ts`, `web-push` in
  `shared/src/push/sink.ts`, and the AI SDKs inside their provider folders.

## The hard rules a plugin must keep

These are checked in review and by tests; see [CLAUDE.md](../CLAUDE.md).

- **No insulin dosing.** Frejsi never computes, suggests or lets anyone enter insulin: no input field, no calculation, no ratio, no correction, no "you should", not in code, AI output schemas, prompts or copy. The one exception is **pump history**: the time and delivered units of a bolus the pump recorded, imported read-only, shown to owners and carers outside simpleMode, never to a viewer, never to an AI model. Showing what the pump delivered is allowed; setting or advising a dose is not.
  A food plugin returns carbohydrates, a glucose plugin returns readings; only a `PumpSource` returns
  what the pump delivered, and it computes nothing from it.
- **Unverified until a human ticks it.** Anything a food source returns reaches the library with
  `verified: false`; the plugin cannot say otherwise. `simpleMode` shows verified foods only.
- **A glucose value never travels or renders without its timestamp.** `Reading` has no schema for a
  value without `ts`.
- **A viewer never receives glucose**, enforced in the API.
- **No raw readings to an AI model**, only computed statistics; photos and text only on an explicit
  user action; a per-space daily cap on AI calls.
- **No secret outside its adapter and the `Secrets` interface.** Credentials never enter the
  database, a log line or an error message. No personal data in logs: the logger takes an allow-list
  of keys.
- **Nothing Danish is hard-coded.** Locale, country and sources are settings.
- **Sources are plugins.** A glucose or food source is added in its own folder, one registration line
  and a fixture set; the core never learns a vendor's name.

To add a source, follow [plugins/food-source.md](plugins/food-source.md) or
[plugins/glucose-source.md](plugins/glucose-source.md).

# @frejsi/poller

The Azure Functions app (Node 22, v4 programming model) that brings glucose into Frejsi. It polls
the configured source every five minutes, stores each new reading once and emits it as a `reading`
event, and it holds the one endpoint that may see a source credential (a Dexcom login or a Nightscout
address with its token or secret): `source-connect`, which checks the credential and puts it in Key
Vault. Spec §3, §3b and §7; plan task 4.

Nothing here knows a host. The adapters and the cycle live in `@frejsi/shared`
(`shared/src/glucose/dexcom-share/`, `shared/src/glucose/nightscout/`,
`shared/src/glucose/poll-cycle.ts`) so the seed and the CLI
run the same code; this package wires them to the Functions host, Prisma, Key Vault and App
Insights.

The adapter only reads. It makes three calls, `General/AuthenticatePublisherAccount`,
`General/LoginPublisherAccountById` and `Publisher/ReadPublisherLatestGlucoseValues`, all `POST`,
and every one goes through `sendShareRequest` (`shared/src/glucose/dexcom-share/transport.ts`),
which refuses any other path or method before a request is sent. The Share API would accept
writes with the same publisher login (uploading readings, follower and alert changes); Frejsi never
makes them (CLAUDE.md, hard rules), and a lint rule keeps `fetch` out of every other file under
`shared/src/glucose/`. The Nightscout adapter reads the same way: two `GET` calls
(`entries/sgv.json` and `verifyauth`) through `sendNightscoutRequest`, the credential in the
`api-secret` header and never in the URL, redirects not followed
([adapter notes](../shared/src/glucose/nightscout/README.md)).

## Source types

`createSourceFactory` (`src/sources.ts`) reads the secret under the space's `secretRef` and picks the
adapter by the config's `type`: `dexcom-share` gets a `DexcomShareSource` (one per space for the life
of the process), `nightscout` a `NightscoutSource` built from the stored address and token or secret.
A secret that does not parse as the credential its type expects is `secret-invalid`, a missing one
`secret-missing`; both count as a failure of that space. With `FAKE_GLUCOSE_SOURCE=1` every space gets
`FakeGlucoseSource` and no secret is read, in the timer and in the CLI alike. A `manual` space (finger-prick
readings typed into the app) is never polled: the cycle records outcome `manual` for it and touches
nothing, so it cannot become `disconnected`.

## Functions

| Name             | Trigger                                     | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `poll`           | timer `0 */5 * * * *`, 0–20 s random jitter | `runPollCycle` over every space with a configured source. A space with readings is asked for the last 30 minutes (back to its last reading after an outage, at most a day); a space with none for a day, so the chart does not start empty. Idempotent on `(spaceId, ts)`: the insert decides what is new (a unique violation means another cycle already stored it), so overlapping cycles never emit twice; one `reading` event per new row through `emit()`, and a row whose event could not be written is removed again so the next cycle stores and emits it together; a `reading.stored` custom event per new row for the 35-minute alert. Every source call has a 30 s deadline. One failing space never stops the others; the third consecutive failure sets `sourceStatus = disconnected` and emits `source.status`, the next success sets `connected` and emits again.                                                                                                                                                   |
| `source-connect` | `POST /api/source-connect`, function key    | Parses `ConnectSourceRequest` (a union on `type`: `dexcom-share` or `nightscout`; `manual` is HTTP 400 `validation`, it has no credential), runs the adapter's `probe()`, and on `ok` reads the last day on the same session (`RECENT_READINGS_WINDOW_MS`), writes the credential to Key Vault as `glucose-<spaceId>` and answers `{ result: "ok", secretRef, recentReadings }` (`recentReadings` is left out when that read failed; the log line carries it as `count`, and a zero also writes `source-connect.no-recent-readings`, the follower-login case the Settings form warns about). The adapter gets the handler's logger, so a refused login writes its own code (`dexcom.probe-failed` with Dexcom's `SSO_…` code) before `source-connect.failed`. Otherwise `{ result: "bad-credentials" }` or `{ result: "unreachable" }`, both HTTP 200 (the result is the contract; the Settings route maps it to an `ApiError` code). A body that is not a `ConnectSourceRequest` is HTTP 400 `{ error: { code: "validation" } }`. |

The Dexcom session is kept per space for the life of the process (one login per process lifetime
per space); a changed credential or region replaces the adapter instance. A credential the service
refuses (`SSO_AuthenticatePasswordInvalid` and the other codes in `CREDENTIAL_CODES`) is not
presented again for an hour (`CREDENTIAL_RETRY_MS`): the cycle keeps counting the failure, so the
space still goes `disconnected` after three, but the poller's own retries cannot lock the Dexcom
account. A new password stored through `source-connect` is tried on the next cycle. The
`poll.space-failed` line carries the stage and the cause (`fetch-failed:Timeout`,
`fetch-failed:SSO_AuthenticatePasswordInvalid`), so one space's bad credential can be told from
another's timeout.

## What never reaches a log

Logs are `shared/src/log.ts` lines: `spaceId`, `count`, `code`, `ms` and nothing else. The adapter's
errors carry the service's error code as their message and no response body. The credential exists
in the `source-connect` request body and in the Key Vault secret value, and nowhere else: not in the
database (`Space.glucoseSource` holds `{ type, region, secretRef }`), not in a log line, not in an
App Insights property (the shared telemetry initializer strips `username` and `password` anyway).

## Settings

| Variable                                | Used by | Notes                                                                                                                                            |
| --------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                          | both    | local development and tests; not set on the Function App in Azure                                                                                |
| `SQL_SERVER_FQDN`, `SQL_DATABASE`       | both    | in Azure the database connection: Entra sign-in as the Function App's managed identity, with no password; used only when `DATABASE_URL` is unset |
| `AZURE_CLIENT_ID`                       | both    | the client id of that user-assigned identity; `DefaultAzureCredential` uses it for SQL, Key Vault and Web PubSub                                 |
| `KEY_VAULT_URL`                         | both    | the vault that holds `glucose-<spaceId>`; managed identity                                                                                       |
| `WEB_PUBSUB_ENDPOINT`, `WEB_PUBSUB_HUB` | `poll`  | live push through `emit()`; unset means rows only, clients poll                                                                                  |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | both    | optional; unset means no telemetry, never a failure                                                                                              |
| `APP_VERSION`                           | both    | the release tag, set by `infra/deploy.sh`                                                                                                        |
| `FAKE_GLUCOSE_SOURCE`                   | both    | `1` runs the cycle against `FakeGlucoseSource`                                                                                                   |

`local.settings.example.json` has the local shape; copy it to `local.settings.json` and fill in your
own values. That file holds a connection string and is not in the repo's `.gitignore`: never stage
it. `echo poller/local.settings.json >> .git/info/exclude` keeps it out of `git add -A` on your
machine without a repo change.

## Build

```
pnpm --filter ./poller build
```

`esbuild.config.mjs` writes a self-contained `dist/` that `func start` runs and `infra/deploy.sh`
zips as is (plan decision 30: Kudu cannot resolve pnpm workspace links):

- `dist/index.js`: one bundle. The entry imports all function modules, so they share a single
  copy of `@frejsi/shared` (the telemetry started at the entry is the one `poll` tracks through).
- `dist/host.json`, `dist/package.json` (`main`, and the externals as its only dependencies).
- `dist/node_modules/`: the externals, installed flat with pnpm from the store (no scripts), plus
  the Prisma client `prisma generate` produced for `shared/prisma/schema.prisma`, query engine for
  the Function App's Linux included.

Externals, in `esbuild.config.mjs`: `@prisma/client` and `.prisma/client` (engine loaded by path),
`applicationinsights` and `@opentelemetry/api-logs` (hook `require` at runtime), and
`@azure/functions-core` (the host's own). `src/index.test.ts` checks every external is a dependency
of this package and, when a `dist/` exists, that each is installed in `dist/node_modules` (the
check is skipped without a build, since walking up to `poller/node_modules` would prove nothing);
the build itself ends with a smoke `require` of each from `dist/` with no `NODE_PATH`.

## Run locally

```
pnpm --filter ./poller build && pnpm --filter ./poller start      # func start, all functions
pnpm --filter ./poller poll --once [--space <id>]                 # one cycle from this machine
FAKE_GLUCOSE_SOURCE=1 pnpm --filter ./poller poll --once          # against the fake source
```

`poll --once` is the setup check against a real account, Dexcom Share or Nightscout (spec §3): it needs `DATABASE_URL` and,
unless `FAKE_GLUCOSE_SOURCE=1`, `KEY_VAULT_URL` with the space's secret in place. It exits 1 when any
space failed. Only `--once` exists; the timer runs in the Function App.

## Tests

`pnpm --filter ./poller test`: the timer schedule and jitter bounds, the summary log, the
`reading.stored` events, the source factory (one Dexcom instance per space, new instance on a changed
credential, the Nightscout dispatch, `secret-missing` / `secret-invalid`, the fake), `source-connect` (probe, store, the three results,
the last day's count and its warning, the adapter's code in the log,
400 on a bad body, nothing credential-shaped in the log), the CLI arguments and the build contract.
The adapters are tested in `shared/` against `fixtures/dexcom-share/` and `fixtures/nightscout/` (hand-written, no real account)
and the cycle against in-memory tables and `FakeGlucoseSource`. No test reaches the network. The
read-only rule has its own tests there: every call in every fixture scenario hits an allow-listed
path with its method, a write path is refused with no `fetch` call, and `GlucoseSource` and each
registered source expose read operations only (`shared/src/glucose/read-only.test.ts`).

## Food enrichment

`enrich-foods` runs every fifteen minutes (`0 */15 * * * *`). It normalises up to 50 unverified remote
source names, cache first, then embeds up to 100 foods in batches. Existing portions and human
verification are preserved; already verified names and portions stay unchanged. Inferred portions
are added only to unverified rows. A matching space copy receives the cleaned name only while its name
still equals the source's original; each space change emits `food.updated`. Failed or capped
normalisation keeps the original and marks it finished. AI and typed foods are never normalised.

Space rows use their enabled space's provider and local-day caps (`AI_DAILY_CAP`, default 50;
`AI_EMBED_DAILY_CAP`, default 500). AI-off spaces are skipped, including name propagation. Groups without an available embedding
provider are excluded before applying the normalisation limit. Cache
rows use `AI_CACHE_EMBED_PROVIDER`, or the first configured embedding adapter, with the UTC-day
`AI_EMBED_BACKFILL_DAILY_CAP` (default 2000). The 100-row embedding budget is shared between groups. Without an embedding adapter the timer logs `ai-not-configured` once and exits without
querying the database. Logs contain counts and codes, never food names or model inputs.

Search sends its text to the capped provider on submit only. Keyword matches stay first within
each tier (library, cache, sources); semantic matches need cosine distance at most 0.35 and the
same embedding identity. A space using another provider searches the cache by keyword only.
Renaming a food clears its vector, so it stays available by keyword until the next backfill.

The provider interface returns its model only after embedding. The search lane therefore stores
`provider:revision:model` in `embeddingModel`: the revision hashes the provider's embedding
configuration and the release tag (`APP_VERSION` in the poller, `NEXT_PUBLIC_APP_VERSION` in web).
A changed release re-embeds eligible rows within the same caps, including changes to an adapter's
default model. Both apps must run the same release/configuration; mismatches fall back to keyword
matches until their identities agree. An unchanged run makes no provider call.

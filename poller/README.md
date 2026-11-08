# @naensom/poller

The Azure Functions app (Node 22, v4 programming model) that brings glucose into Nænsom. It polls
the configured source every five minutes, stores each new reading once and emits it as a `reading`
event, and it holds the one endpoint that may see a source credential (a Dexcom login or a Nightscout
address with its token or secret): `source-connect`, which checks the credential and puts it in Key
Vault. Spec §3, §3b and §7; plan task 4. Since v0.7.0 it also reads the pump record, what the pump
delivered, from a Nightscout site every fifteen minutes ([below](#pump-record)).

Nothing here knows a host. The adapters and the cycle live in `@naensom/shared`
(`shared/src/glucose/dexcom-share/`, `shared/src/glucose/nightscout/`,
`shared/src/glucose/poll-cycle.ts`) so the seed and the CLI
run the same code; this package wires them to the Functions host, Prisma, Key Vault and App
Insights.

The adapter only reads. It makes three calls, `General/AuthenticatePublisherAccount`,
`General/LoginPublisherAccountById` and `Publisher/ReadPublisherLatestGlucoseValues`, all `POST`,
and every one goes through `sendShareRequest` (`shared/src/glucose/dexcom-share/transport.ts`),
which refuses any other path or method before a request is sent. The Share API would accept
writes with the same publisher login (uploading readings, follower and alert changes); Nænsom never
makes them (CLAUDE.md, hard rules), and a lint rule keeps `fetch` out of every other file under
`shared/src/glucose/`. The Nightscout adapter reads the same way: two `GET` calls
(`entries/sgv.json` and `verifyauth`, plus `treatments.json` for the pump record) through `sendNightscoutRequest`, the credential in the
`api-secret` header and never in the URL, redirects not followed
([adapter notes](../shared/src/glucose/nightscout/README.md)).

## Source types

`createSourceFactory` (`src/sources.ts`) reads the secret the space's `secretRef` names and picks the
adapter by the config's `type`. The reference is `glucose-<spaceId>/<version>`: the one version of
the secret that `source-connect` wrote and answered, saved on the space by the Settings route in the
same config as the region, so the poller reads the credential this config was committed with and
never a newer version that no config refers to (#78). A plain `glucose-<spaceId>` from before v0.5.4
reads the latest version. By type, `dexcom-share` gets a `DexcomShareSource` (one per space for the life
of the process), `nightscout` a `NightscoutSource` built from the stored address and token or secret.
A secret that does not parse as the credential its type expects is `secret-invalid`, a missing one
`secret-missing`; both count as a failure of that space. With `FAKE_GLUCOSE_SOURCE=1` every space gets
`FakeGlucoseSource` and no secret is read, in the timer and in the CLI alike. A `manual` space (finger-prick
readings typed into the app) is never polled: the cycle records outcome `manual` for it and touches
nothing, so it cannot become `disconnected`.

## Functions

| Name              | Trigger                                                 | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `poll`            | timer `0 */5 * * * *`, 0–20 s random jitter             | `runPollCycle` over every space with a configured source. A space with readings is asked for the last 30 minutes (back to its last reading after an outage, at most a day); a space with none for a day, so the chart does not start empty. Idempotent on `(spaceId, ts)`: the insert decides what is new (a unique violation means another cycle already stored it), so overlapping cycles never emit twice; one `reading` event per new row through `emit()`, and a row whose event could not be written is removed again so the next cycle stores and emits it together; a `reading.stored` custom event per new row for the 35-minute alert. Every source call has a 30 s deadline. One failing space never stops the others; the third consecutive failure sets `sourceStatus = disconnected` and emits `source.status`, the next success sets `connected` and emits again.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `source-connect`  | `POST /api/source-connect`, function key                | Parses `ConnectSourceRequest` (a union on `type`: `dexcom-share` or `nightscout`; `manual` is HTTP 400 `validation`, it has no credential), runs the adapter's `probe()`, and on `ok` reads the last day on the same session (`RECENT_READINGS_WINDOW_MS`), writes the credential to Key Vault as a new version of `glucose-<spaceId>` and answers `{ result: "ok", secretRef, recentReadings }` with `secretRef` naming exactly that version, `glucose-<spaceId>/<version>` (the Settings route saves it with the region in one write, so a failed write leaves the previous reference in force and two connects at once cannot pair one request's region with the other's credential; #78) (`recentReadings` is left out when that read failed; the log line carries it as `count`, and a zero also writes `source-connect.no-recent-readings`, the follower-login case the Settings form warns about). The adapter gets the handler's logger, so a refused login writes its own code (`dexcom.probe-failed` with Dexcom's `SSO_…` code) before `source-connect.failed`. Otherwise `{ result: "bad-credentials" }` or `{ result: "unreachable" }`, both HTTP 200 (the result is the contract; the Settings route maps it to an `ApiError` code). A body with `purpose: "pump"` is the pump record's connect, parsed strictly and first as a `ConnectPumpRequest`: it probes the Nightscout site, reads the last day of boluses and on `ok` writes a new version of `pump-<spaceId>`, answering `{ result: "ok", secretRef, recentBoluses }` (`pump-connect.no-recent-boluses` when the day is empty); it never writes `glucose-<spaceId>`. A body that is neither is HTTP 400 `{ error: { code: "validation" } }`. |
| `pump-poll`       | timer `0 */15 * * * *`, 0–20 s random jitter            | `runPumpCycle` over every space with a pump source, four at a time: reads the boluses of the window below, stores each once on `(spaceId, sourceId)`, links each meal to its bolus, makes the pump meals that are due, and emits `pump.imported`, `pump.meals` and `pump.status` (the glucose group only). One `pump.cycle` line per run. See [Pump record](#pump-record).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `live-poll`       | timer `0 * * * * *`                                     | The iPhone push relay: every due `LiveSubscription` (16 sites at once), one Live Activity `update` per new reading, the 8-hour restart, the low/high reminders and the 30-day cleanup. One `live.poll` line per run. See [iPhone push relay](#iphone-push-relay).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `live-register`   | `POST /api/live/register`, anonymous                    | The app's create or update of its subscription (`LiveRegisterRequest`): checks a new Nightscout token by reading one entry, stores address and token as a version of `live-<id>`, answers the device secret once on create. Update needs `x-device-secret`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `live-unregister` | `DELETE /api/live/register/{subscriptionId}`, anonymous | "Remove this phone": with `x-device-secret`, deletes the row and `live-<id>`; 204, also when it is already gone.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

The Dexcom session is kept per space for the life of the process (one login per process lifetime
per space); a changed credential or region replaces the adapter instance. A credential the service
refuses (`SSO_AuthenticatePasswordInvalid` and the other codes in `CREDENTIAL_CODES`) is not
presented again for an hour (`CREDENTIAL_RETRY_MS`): the cycle keeps counting the failure, so the
space still goes `disconnected` after three, but the poller's own retries cannot lock the Dexcom
account. A new password stored through `source-connect` is tried on the next cycle. The
`poll.space-failed` line carries the stage and the cause (`fetch-failed:Timeout`,
`fetch-failed:SSO_AuthenticatePasswordInvalid`), so one space's bad credential can be told from
another's timeout.

## Pump record

`pump-poll` (`src/functions/pump-poll.ts`, `src/pump-handler.ts`) is a timer of its own, separate from
`poll`, so a slow Nightscout site never delays a glucose cycle; it runs in the same Function App and
needs no infrastructure of its own. Every fifteen minutes, after a random 0–20 s wait, it runs
`runPumpCycle` (`shared/src/pump/poll-cycle.ts`) once and writes one `pump.cycle` line: `count` is
the new boluses, `code` is `ok` or how many spaces failed (`2-failed`), `ms` the run's length.

- **Which spaces.** Every space with `Space.pumpSource` set, four at a time; a space without one is
  never read. One space's failure never stops or changes another's.
- **The source.** `createPumpSourceFactory` (`src/sources.ts`) reads the secret the config's
  `secretRef` names, `pump-<spaceId>/<version>` as `source-connect` answered it for a body with
  `purpose: "pump"`, and builds a `NightscoutPumpSource` on the allow-listed transport. That is the
  only source it builds. A missing secret (`secret-missing`) or one that is not a Nightscout
  credential (`secret-invalid`) counts as one failure of that space.
- **The window.** `since = max(now − 14 d, min(now − 24 h, lastPumpAt − 3 h))`: a first run reads
  14 days, every later run at least the last day and three hours behind the newest stored bolus,
  because Tandem's upload lags by up to an hour and can arrive in a burst.
- **Storing.** New records are committed one day at a time, each commit a Serializable transaction
  with a 30 s timeout, retried once on a serialization failure or a concurrent insert of the same
  bolus. Each commit links the meals near the new boluses to their bolus (`Meal.pumpBolusId` and
  `bolusTs`), makes a pump meal for a carb bolus with no meal once it is two hours old (`source:
"pump"`, one manual line, unverified until a carer ticks it), and moves `lastPumpAt` forward. The
  events go out in the same transaction: `pump.meals` for every meal it changed and, once per cycle,
  `pump.imported` with the count and the range. A re-poll stores and emits nothing.
- **Status.** Three consecutive failures of the source set `pumpStatus = disconnected` and emit
  `pump.status`; the next success sets `connected` and emits again. A database failure after a good
  fetch is logged (`store-failed`) and does not count against the source.

There is no CLI for the pump cycle: `func start` runs `pump-poll` with the other functions.

## iPhone push relay

The relay keeps the iPhone app's Live Activity current while the app is closed (plan
`docs/superpowers/plans/2026-11-08-ios-follower-app.md` §4, §5). It is three functions in this app
(`src/functions/live-*.ts`, logic in `src/live/`) and one table, `LiveSubscription` (migration
`0007_live`). A subscription is one phone following one Nightscout site; it is not tied to a space
and stores no reading history, only the newest reading's time.

**Register.** The app posts its Nightscout address and `readable` token, its push tokens
(push-to-start, the current activity's, and the app's own device token for alerts), the APNs
environment, unit, the four thresholds, `alertsOn` and its language (`LiveRegisterRequest` in
`shared/src/schemas/live.ts`, the contract with `ios/`). The address must be `https` (`400
not-https`) or the literal `demo`. A new token or address is checked by reading one entry through
`NightscoutSource` (`422 nightscout-refused` on 401/403, `nightscout-unreachable` otherwise) and
stored in Key Vault as a version of `live-<subscriptionId>`; the row keeps the reference and the
host name only. Create answers `{ subscriptionId, deviceSecret }`: 32 random bytes, answered once,
kept as a SHA-256 and compared in constant time. Update (on every launch and background wake) and
delete need it in `x-device-secret` (`401 bad-device-secret`, also for an unknown id). A token field
left out keeps the stored one; `null` clears it. An activity older than the one the relay already
knows is ignored, so the app reporting the activity the 8-hour restart ended cannot undo it. Rate
limits per client IP (the last `x-forwarded-for` hop, the one Azure appends): 60 requests in 10 minutes, and 10 an hour that create or
check a site (`429 rate-limited`). They are in memory, per Function App instance: a scaled-out app
allows that much per instance, enough to stop one phone or script from hammering the relay or a
Nightscout site through it.

**Poll.** `live-poll` runs every minute and takes every subscription whose `nextCheckAt` has come
(within 20 s): the newest reading + 5 min 15 s, then every minute until a new reading arrives,
every five minutes once the newest is 20 minutes old (`src/live/schedule.ts`). It reads the newest
three entries (`latestEntries(3)`, 15 s deadline, at most 16 sites at once, credentials cached per
process by their versioned reference) and, when the newest reading is new, sends one `update`
(priority 10, `stale-date` and `apns-expiration` = reading + 15 min). Apple's 5xx, 429 or a failed
connection leaves the reading unsent, and the next run, a minute later, tries again.

**The 8-hour restart.** At 7 h 45 min from `activityStartedAt` (with a push-to-start token) the
relay sends `end` to the activity token, then a push-to-start with the current reading and
`input-push-token: 1`, with a short alert in the subscription's language and no value. The old
activity token is cleared (only if the row still holds it) until the app registers the new
activity's. A start Apple refuses stops the attempts; the app then offers "tap to restart".

**Low/high reminders.** With `alertsOn` and a device token, a reading below `lowMgdl` or above
`highMgdl` sends one `alert` push (`interruption-level: time-sensitive`) to the device token:
"Lav: 3,6 mmol/L · 2 min siden" / "Low: 3.6 mmol/L · 2 min ago", with a body saying it is a reminder
and the CGM app's alarms still apply (`shared/src/live/messages/`). Again after 30 minutes if still
out of range; a reading back in range resets it. Once when the newest reading is 20 minutes old
("Ingen nye målinger i 20 min"), also while the site cannot be read. `lastAlertKind` and
`lastAlertAt` keep the state.

**Demo.** A subscription with the address `demo` follows a made-up curve the relay computes from the
time (`src/live/demo.ts`): readings every five minutes between about 67 and 183 mg/dL. No site is
read and nothing is stored in Key Vault. App Review and the Simulator use it.

**APNs.** Token auth with the `.p8` key from Key Vault `apns-key-p8`, read once per process; one
`ApnsSender` (one HTTP/2 connection) per environment, sandbox for Debug builds and production for
TestFlight and the App Store, as the app registered.

**Cleanup.** `lastSeenAt` moves forward on every push Apple accepts and every registration. A token
Apple answers 410, `BadDeviceToken` or `Unregistered` for is cleared; when no token is left the
subscription is deleted with its Key Vault secret (the secret first). So is one whose push-to-start
token Apple rejects at the 8-hour restart while no activity token is left (the restart ends the old
one), even if a device token for reminders remains: the app is gone from the phone (`live.removed`
with `push-to-start-invalid`). An activity token the app registered meanwhile keeps it until that
activity ends. "Remove this phone" deletes both at once (an app that could not reach the relay keeps
trying the `DELETE` until it answers 204, 401 or 404), and
each run deletes up to 100 subscriptions whose `lastSeenAt` is 30 days old (only if the app has not
registered since the run selected them). A subscription with no push token at all reads no site, is
looked at hourly, and goes after a day without one. A reading dated more than two minutes ahead is a
clock error and is ignored.

The idle and tokenless cleanups delete the row first, guarded by `lastSeenAt` so a registration
that comes in meanwhile keeps its subscription and stored token, and then `live-<id>`, tried twice.
A secret both tries failed for is not left for good: the run that starts in minute 0 of each hour
lists the `live-` secrets (names and write times, never values, `Secrets.list`) and deletes every
one older than an hour whose subscription has no row, up to 100 per sweep
(`live.secret-orphan-removed`). The hour of grace covers a registration, which writes the secret
before its row. A failed listing or delete is `live.secret-sweep-failed` and is tried again the
next hour; a failed inline delete is `live.secret-delete-failed`.

**Logs** carry the subscription id and outcome codes (`update:200`, `start:410:Unregistered`,
`alert-low:200`, `Timeout`), never an address, a token, a secret, an IP or a value.

## What never reaches a log

Logs are `shared/src/log.ts` lines: `spaceId`, `count`, `code`, `ms` and nothing else. The adapter's
errors carry the service's error code as their message and no response body. The credential exists
in the `source-connect` request body and in the Key Vault secret value, and nowhere else: not in the
database (`Space.glucoseSource` holds `{ type, region, secretRef }`, and the reference is a name and
a version, never a value), not in a log line, not in an
App Insights property (the shared telemetry initializer strips `username` and `password` anyway).
The pump record's lines carry space ids, counts and codes too, never an address, a token, units or
carbs; its credential is stored only as a version of `pump-<spaceId>`, and `Space.pumpSource` holds
`{ type, secretRef, connectedBy }`. The push relay's lines carry a `subscriptionId` and codes; its
Nightscout address and token exist only in the register request and in `live-<subscriptionId>`, its
device secret only as a hash.

## Settings

| Variable                                | Used by | Notes                                                                                                                                            |
| --------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                          | both    | local development and tests; not set on the Function App in Azure                                                                                |
| `SQL_SERVER_FQDN`, `SQL_DATABASE`       | both    | in Azure the database connection: Entra sign-in as the Function App's managed identity, with no password; used only when `DATABASE_URL` is unset |
| `AZURE_CLIENT_ID`                       | both    | the client id of that user-assigned identity; `DefaultAzureCredential` uses it for SQL, Key Vault and Web PubSub                                 |
| `KEY_VAULT_URL`                         | both    | the vault that holds the versions of `glucose-<spaceId>`, `pump-<spaceId>` and `live-<subscriptionId>`, and `apns-key-p8`; managed identity      |
| `WEB_PUBSUB_ENDPOINT`, `WEB_PUBSUB_HUB` | timers  | live push through `emit()`; unset means rows only, clients poll                                                                                  |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | both    | optional; unset means no telemetry, never a failure                                                                                              |
| `APP_VERSION`                           | both    | the release tag, set by `infra/deploy.sh`                                                                                                        |
| `FAKE_GLUCOSE_SOURCE`                   | both    | `1` runs the cycle against `FakeGlucoseSource`                                                                                                   |

`local.settings.example.json` has the local shape; copy it to `local.settings.json` and fill in your
own values. That file holds a connection string and is not in the repo's `.gitignore`: never stage
it. `echo poller/local.settings.json >> .git/info/exclude` keeps it out of `git add -A` on your
machine without a repo change.

## iPhone push test

`pnpm --filter ./poller push-test` is the iPhone app's stage-2 test (plan
`docs/superpowers/plans/2026-11-08-ios-follower-app.md` §7; steps in
[ios/README.md](../ios/README.md#the-push-test-stage-2)). It runs on an operator's machine, not in
the Function App: it reads a Nightscout site (`NS_URL`, `NS_TOKEN`; `NightscoutSource.latestEntries`,
the same allow-listed `GET entries/sgv.json`), sends one Live Activity `update` push per new reading
through `src/live/apns.ts`, and at 7 h 45 min ends the activity and starts a new one by
push-to-start. `src/live/apns.ts` is the APNs sender the [relay](#iphone-push-relay) uses too: Node `http2`, an ES256
provider token from the `.p8` key (Key Vault secret `apns-key-p8`, key ID `P9HBN8RRS3`, team
`B32HGH682W`), renewed every 50 minutes, sandbox or production host. `src/live/payloads.ts` builds
the `update`, `end` and push-to-start payloads; their content state is pinned by the fixture the
Swift package tests against. The log carries outcome codes only (`update:200`,
`update:400:BadDeviceToken`); times and values go only to the local CSV the operator names.

## Build

```
pnpm --filter ./poller build
```

`esbuild.config.mjs` writes a self-contained `dist/` that `func start` runs and `infra/deploy.sh`
zips as is (plan decision 30: Kudu cannot resolve pnpm workspace links):

- `dist/index.js`: one bundle. The entry imports all function modules, so they share a single
  copy of `@naensom/shared` (the telemetry started at the entry is the one `poll` tracks through).
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

`pnpm --filter ./poller test`: the timer schedules and jitter bounds (`poll` and `pump-poll`), the summary logs, the
`reading.stored` events, the source factory (one Dexcom instance per space, new instance on a changed
credential, the Nightscout dispatch, `secret-missing` / `secret-invalid`, the fake, the pump factory), `source-connect` (probe, store, the three results, the pump connect that never writes the glucose secret,
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

A third pass (v0.6.0) places up to 50 foods per run that have no category yet (`Food.category`
is null) and whose name did not come from a person: foods typed in the library or the log and
dishes from a recipe (`family`, `manual`, `recipe`) are never sent, since a person's own text
reaches a model only on an explicit action; source foods and AI guesses are. One small call per
food under the same daily cap as the names (`AI_DAILY_CAP`), answering exactly one of the ten
categories. The category is written to the row and to every unplaced copy of the same source food
in the cache and the enabled spaces, whichever copy was asked about; each space copy's change
emits `food.updated`. Nothing else changes: not `verified`, not the name, not
the portions. A failed, capped or off-schema answer leaves the row unplaced for a later run; a
category a person has chosen is never overwritten. Foods from Frida and Open Food Facts usually
arrive with a category from their source and never reach this pass.

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

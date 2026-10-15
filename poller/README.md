# @frejsi/poller

The Azure Functions app (Node 22, v4 programming model) that brings glucose into Frejsi. It polls
the configured source every five minutes, stores each new reading once and emits it as a `reading`
event, and it holds the one endpoint that may see a Dexcom login: `source-connect`, which checks the
credential and puts it in Key Vault. Spec §3, §3b and §7; plan task 4.

Nothing here knows Dexcom. The adapter and the cycle live in `@frejsi/shared`
(`shared/src/glucose/dexcom-share/`, `shared/src/glucose/poll-cycle.ts`) so the seed and the CLI
run the same code; this package wires them to the Functions host, Prisma, Key Vault and App
Insights.

## Functions

| Name             | Trigger                                     | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `poll`           | timer `0 */5 * * * *`, 0–20 s random jitter | `runPollCycle` over every space with a configured source. A space with readings is asked for the last 30 minutes (back to its last reading after an outage, at most a day); a space with none for a day, so the chart does not start empty. Idempotent on `(spaceId, ts)`: the insert decides what is new (a unique violation means another cycle already stored it), so overlapping cycles never emit twice; one `reading` event per new row through `emit()`, and a row whose event could not be written is removed again so the next cycle stores and emits it together; a `reading.stored` custom event per new row for the 35-minute alert. Every Dexcom call has a 30 s deadline. One failing space never stops the others; the third consecutive failure sets `sourceStatus = disconnected` and emits `source.status`, the next success sets `connected` and emits again. |
| `source-connect` | `POST /api/source-connect`, function key    | Parses `ConnectSourceRequest`, runs the adapter's `probe()`, and on `ok` writes the credential to Key Vault as `glucose-<spaceId>` and answers `{ result: "ok", secretRef }`. Otherwise `{ result: "bad-credentials" }` or `{ result: "unreachable" }`, both HTTP 200 (the result is the contract; the Settings route maps it to an `ApiError` code). A body that is not a `ConnectSourceRequest` is HTTP 400 `{ error: { code: "validation" } }`.                                                                                                                                                                                                                                                                                                                                                                                                                               |

The Dexcom session is kept per space for the life of the process (one login per process lifetime
per space); a changed credential or region replaces the adapter instance.

## What never reaches a log

Logs are `shared/src/log.ts` lines: `spaceId`, `count`, `code`, `ms` and nothing else. The adapter's
errors carry the service's error code as their message and no response body. The credential exists
in the `source-connect` request body and in the Key Vault secret value, and nowhere else: not in the
database (`Space.glucoseSource` holds `{ type, region, secretRef }`), not in a log line, not in an
App Insights property (the shared telemetry initializer strips `username` and `password` anyway).

## Settings

| Variable                                | Used by  | Notes                                                           |
| --------------------------------------- | -------- | --------------------------------------------------------------- |
| `DATABASE_URL`                          | both     | Key Vault reference on the Function App                         |
| `KEY_VAULT_URL`                         | both     | the vault that holds `glucose-<spaceId>`; managed identity      |
| `WEB_PUBSUB_ENDPOINT`, `WEB_PUBSUB_HUB` | `poll`   | live push through `emit()`; unset means rows only, clients poll |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | both     | optional; unset means no telemetry, never a failure             |
| `APP_VERSION`                           | both     | the release tag, set by `infra/deploy.sh`                       |
| `FAKE_GLUCOSE_SOURCE`                   | CLI only | `1` runs the cycle against `FakeGlucoseSource`                  |

`local.settings.example.json` has the local shape; copy it to `local.settings.json` (ignored by git).

## Build

```
pnpm --filter ./poller build
```

`esbuild.config.mjs` writes a self-contained `dist/` that `func start` runs and `infra/deploy.sh`
zips as is (plan decision 30: Kudu cannot resolve pnpm workspace links):

- `dist/index.js`: one bundle. The entry imports both function modules, so they share a single
  copy of `@frejsi/shared` (the telemetry started at the entry is the one `poll` tracks through).
- `dist/host.json`, `dist/package.json` (`main`, and the externals as its only dependencies).
- `dist/node_modules/`: the externals, installed flat with pnpm from the store (no scripts), plus
  the Prisma client `prisma generate` produced for `shared/prisma/schema.prisma`, query engine for
  the Function App's Linux included.

Externals, in `esbuild.config.mjs`: `@prisma/client` and `.prisma/client` (engine loaded by path),
`applicationinsights` and `@opentelemetry/api-logs` (hook `require` at runtime), and
`@azure/functions-core` (the host's own). `src/index.test.ts` checks every external is a dependency
of this package and resolves from `dist/`; the build ends with a smoke `require` of each from
`dist/` with no `NODE_PATH`.

## Run locally

```
pnpm --filter ./poller build && pnpm --filter ./poller start      # func start, both functions
pnpm --filter ./poller poll --once [--space <id>]                 # one cycle from this machine
FAKE_GLUCOSE_SOURCE=1 pnpm --filter ./poller poll --once          # against the fake source
```

`poll --once` is the setup check against a real account (spec §3): it needs `DATABASE_URL` and,
unless `FAKE_GLUCOSE_SOURCE=1`, `KEY_VAULT_URL` with the space's secret in place. It exits 1 when any
space failed. Only `--once` exists; the timer runs in the Function App.

## Tests

`pnpm --filter ./poller test`: the timer schedule and jitter bounds, the summary log, the
`reading.stored` events, the source factory (one instance per space, new instance on a changed
credential, `secret-missing` / `secret-invalid`), `source-connect` (probe, store, the three results,
400 on a bad body, nothing credential-shaped in the log), the CLI arguments and the build contract.
The adapter is tested in `shared/` against `fixtures/dexcom-share/` (hand-written, no real account)
and the cycle against in-memory tables and `FakeGlucoseSource`. No test reaches the network.

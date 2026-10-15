# Operations

How to run Frejsi in production: the first space, the one alert, rolling back and changing the
Dexcom login. It assumes the Azure setup in `infra/README.md` ("What the owner does once") is done.
Spec §7 and §9; plan `docs/superpowers/plans/2026-10-14-v0.1.0-foundation.md` §7, §9 and task 10.

Everything below uses the Azure CLI signed in as you (`az login`) and the resource group `frejsi`.
The Key Vault is the only `kv-frejsi-<suffix>` in it; find its name once with:

```sh
VAULT=$(az keyvault list -g frejsi --query '[0].name' -o tsv)
```

## Bootstrap the first space

Run this once, after the first release is green. `POST /api/bootstrap` creates the space, makes you
its owner and returns a single-use invitation link for your first device. The route answers `404`
once any space exists, so it does nothing after this.

1. Give yourself **Key Vault Secrets User** on the vault, or read the secret on the portal's Secrets
   page instead (`infra/README.md`, step 8).
2. Read the token into a shell variable. It is never printed, never in your shell history and never
   in a file:

   ```sh
   TOKEN=$(az keyvault secret show --vault-name "$VAULT" -n bootstrap-token --query value -o tsv)
   ```

3. Send the one request. Replace the space name and your name. The timezone is an IANA name: it has
   no default, so nothing Danish is built in.

   ```sh
   curl -fsS -X POST https://frejsi.jepsen.ninja/api/bootstrap \
     -H "content-type: application/json" \
     -H "x-bootstrap-token: $TOKEN" \
     -d '{"spaceName":"<space name>","ownerName":"<your name>","timezone":"Europe/Copenhagen"}'
   unset TOKEN
   ```

   The answer is `{ "spaceId", "inviteUrl", "expiresAt" }`. Before the custom domain is in place, use
   the Static Web App's default hostname instead (`az staticwebapp list -g frejsi --query '[0].defaultHostname' -o tsv`).

4. Open `inviteUrl` on your phone and create the passkey. The link can be used once and expires after
   seven days. Nobody logs it, including Frejsi, so it exists only in your terminal: clear the
   scrollback when you are done.
5. Invite everyone else from **Personer** (owners only): an invitation link or a QR code per person,
   with the role they get. An extra device for someone who is already in the space is "Tilføj en
   enhed" on their row.

What the answers mean:

| Status           | Meaning                                                                                                               |
| ---------------- | --------------------------------------------------------------------------------------------------------------------- |
| `200`            | The space exists; the link is in the body.                                                                            |
| `401 forbidden`  | The token is wrong. It changes on every infra deploy, so read it again; the app gets the new one on the next release. |
| `400 validation` | The body is wrong: an empty name, or a timezone that is not an IANA name.                                             |
| `404 not-found`  | A space exists already. Bootstrap is over; use invitations from Personer.                                             |

## The 35-minute alert

**"Frejsi: no glucose reading stored for 35 minutes"** goes to `ALERT_EMAIL` when the poller has not
stored a single reading for 35 minutes. It counts the `reading.stored` event the poller sends for
every new row, so it measures the whole chain: Dexcom Share, the poller, the database. A sensor change
gives a gap of about 30 minutes, which is why the limit is 35. The alert resolves itself with the
next stored reading.

Check in this order and stop at the first thing that is wrong:

1. **The sensor and the Dexcom app.** If the Dexcom app shows no values either (a sensor change, the
   warm-up, the phone out of range or Share switched off in the app), Frejsi has nothing to fetch.
   Wait for the app to show values again; the poller fills the gap by itself (it reaches back to the
   last stored reading, up to a day).
2. **Settings → Glukosekilde.** "Ingen forbindelse" means three cycles in a row failed against the
   source. Owners and carers also see the banner "Ingen forbindelse til Dexcom Share siden ..." on Nu.
   If the Dexcom password changed, or the Share account was locked or removed, change the login (next
   section).
3. **`https://frejsi.jepsen.ninja/api/health`.** `db: "error"` means the app cannot reach Azure SQL;
   look at the SQL database in the portal. `readings: "stale"` agrees with the alert; `readings:
"fresh"` means a reading did arrive and the alert will resolve itself.
4. **The poller's log.** Application Insights → Logs:

   ```kusto
   traces
   | where timestamp > ago(1h)
   | where message contains "poll."
   | project timestamp, message
   | order by timestamp desc
   ```

   Every cycle writes one `poll.space` line per space and a `poll.cycle` summary. A failing space writes
   `poll.space-failed` with the stage and the cause in `code`:
   - `fetch-failed:SSO_AuthenticatePasswordInvalid` (or another `SSO_...` code): Dexcom refused the
     login. Change it in Settings. A refused login is not tried again for an hour, so the Dexcom
     account is not locked by retries; the new one is tried on the next cycle.
   - `fetch-failed:Timeout` or a network error: Dexcom Share did not answer in 30 seconds. Usually
     theirs and temporary; nothing to do unless it lasts.
   - `source-unavailable:secret-missing` or `secret-invalid`: the credential in Key Vault is missing
     or unreadable. Connect the source again from Settings.
   - `store-failed:...` or `status-update-failed:...`: the database. See step 3.

5. **The Function App.** If there are no `poll.` lines at all, the timer is not running. Portal →
   Function App → `poll` → Invocations. A release that failed half way can leave an old package; the
   deploy job checks `WEBSITE_RUN_FROM_PACKAGE`, and redeploying the current tag (next section but one)
   puts it right.

## Change the Dexcom login

The Dexcom Share credential is entered on the site and nowhere else. It goes from the browser to the
Function App's `source-connect` endpoint, which tries it against Dexcom and only then writes it to Key
Vault as `glucose-<spaceId>`. The database holds the source type, the region and the secret's name,
never the login.

1. Sign in as an **owner** and open **Indstillinger → Glukosekilde → Skift login** (on the phone,
   Indstillinger is the Mere tab).
2. Enter the username and password of the Dexcom account that **shares** the data (the one on the
   phone running the Dexcom app, not a follower's), and the server region: EU for accounts outside
   the US.
3. **Forbind.** Frejsi asks Dexcom right away:
   - accepted: the status turns "Forbundet" and the next cycle (within five minutes) fetches.
   - "Brugernavn eller kodeord passer ikke." (`source-bad-credentials`): nothing was saved; the old
     login stays. Check the username, the password and the region.
   - "Vi kunne ikke få forbindelse til kilden lige nu." (`source-unreachable`): nothing was saved; try
     again later.

Carers see the source and its status but cannot change it; viewers do not see it.

## Roll back to an earlier version

A release is a tag. To put an earlier tag back into production:

1. GitHub → Actions → **release** → **Run workflow**.
2. **Tag:** the tag to deploy, for example `v0.1.0`. Leave **infra** unticked unless a repository
   variable changed since that tag was built (`CUSTOM_DOMAIN`, for instance); ticking it asks for the
   owner's approval on `production-infra`.
3. Run it. The workflow checks out that tag, runs the full suite against it, builds it with
   `NEXT_PUBLIC_APP_VERSION` set to the tag, deploys it and smoke-tests `/api/health` until it reports
   that version. A redeploy creates no GitHub release and does not touch the milestone.

Database migrations only go forward: `prisma migrate deploy` from an older tag applies nothing and
removes nothing. Rolling back across a release that changed the schema needs the older code to work
on the newer schema; check the PRs between the two tags before you roll back. v0.1.0 has one
migration, `0001_foundation`.

## Run the release suites locally

`release.yml` runs two suites that `ci.yml` does not: the Prisma integration tests and the Playwright
flows. Both need a SQL Server; the e2e also needs a production build and Chromium.

```sh
docker run -d --name frejsi-sql --restart unless-stopped -e ACCEPT_EULA=Y \
  -e MSSQL_SA_PASSWORD='<a strong password>' -p 14330:1433 mcr.microsoft.com/mssql/server:2022-latest
export DATABASE_URL="sqlserver://localhost:14330;database=frejsi_test;user=sa;password=<the same password>;encrypt=true;trustServerCertificate=true"

pnpm --filter ./shared test:integration      # its own database per run, dropped afterwards
NEXT_PUBLIC_APP_VERSION=v0.1.0 pnpm -r build
pnpm --filter ./web test:e2e                 # drops and recreates <database>_e2e, then migrates and seeds
```

Neither suite writes to the database `DATABASE_URL` names: the integration tests create and drop
`frejsi_it_<random>`, and the e2e recreates `<database>_e2e` on every run. The e2e installs Chromium
when it is missing and writes the server's log to `web/e2e/.output/server.log`, which its last test
checks for the seeded names.

For development, `pnpm --filter ./web seed` fills an empty database with the fictional space of the
artboards ("Almas rum": Jonas and Mette as owners, Birthe as a carer, Alma as a carer in simpleMode,
Lærke as a viewer, fourteen local dates of fake readings) and prints one add-a-device link per
person. Today stops at the seed clock. The fake returns at most 24 hours per daily cycle, so a
25-hour autumn date can have an uncovered hour. It refuses to run with `NODE_ENV=production` and on a database that already has a space.

## Food sources and refreshing Frida

`FOOD_SOURCES=off,frida` enables the registered plugins in that order. Empty or missing means no
external sources; the space library and shared cache still work. `OFF_COUNTRY` selects the country
boost, `OFF_LANGUAGE` the barcode language, and text search uses the session locale. These settings
belong to the web app. Results are unverified until a carer checks the space copy; the shared cache
is never verified.

The OFF adapter shares process-wide token buckets: **10 search HTTP requests and 15 product reads
per minute**, refilling continuously. Country/world search fallback uses two search tokens. Errors
consume their tokens too. Multiple web processes sharing an outbound IP still share OFF's upstream
budget; `rate-limited`/HTTP 429 is a source-status notice, not an empty verified result. Remote text
search runs on submit; typing searches the library, cache and local plugins. OFF images are neither
fetched nor stored. See `shared/src/food/off/README.md` for the adapter contract and limits.

Frida is a bundled JSON dataset, not a runtime download or database import. To refresh it:

1. Follow `shared/src/food/frida/data/README.md` to download the pinned DTU workbook (or document a
   newer release), recheck its licence/hash, and project the named sheets to a UTF-8 CSV.
2. Use **available carbohydrate, excluding fibre** (parameter 172 in the pinned workbook), not
   carbohydrate by difference. Recheck the column headers for a new version; do not subtract fibre
   again. Keep the workbook and CSV outside the repository.
3. Run `pnpm --filter ./shared frida:import /tmp/frejsi-frida.csv`, then import to
   `/tmp/frida-check.json` as the optional second argument and compare the two outputs. Run
   `pnpm --filter ./shared test src/food/frida`.
4. Commit the generated `shared/src/food/frida/data/frida.json` and its updated provenance,
   attribution and licence together. Release the app normally to replace the bundled data. Tests
   use the fictional excerpt and never download DTU or call OFF.

## Private photos and local storage

The private `photos` container contains paired JPEGs at
`spaces/<spaceId>/foods/<foodId>/<random>/original.jpg` and `thumb.jpg`, or the equivalent
`meals/<mealId>` paths. Originals are at most 1600 px on the long edge; thumbnails are 320×320.
The server applies orientation and strips EXIF, GPS and ICC metadata. The API issues read-only SAS
URLs expiring at the next full hour plus one hour. Treat signed URLs as credentials: do not log or
share them. Nothing is uploaded on preview; saving the food or meal triggers upload.

Deleting a food commits its database deletion and `food.deleted` event, nulling meal-item links
while preserving their name/carbs snapshots, then deletes both blobs. Replacing/removing a photo
also cleans the displaced pair after commit; meal deletion behaves the same way. Cleanup is best
effort. `photo.cleanup-failed` or `meal.photo-delete-failed` with `photo-unavailable` means the
record change succeeded but storage cleanup failed. There is no automatic retry queue: inspect
orphaned pairs against remaining Food/Meal `photoKey` references and remove only unreferenced
pairs, without logging keys or signed URLs. Production blob soft delete retains deleted blobs for
seven days; deletion is not an immediate physical purge.

For local development, run Azurite's Blob service on localhost:10000 (for example
`docker run --rm -p 10000:10000 mcr.microsoft.com/azure-storage/azurite azurite-blob --blobHost 0.0.0.0`).
Set `BLOB_CONNECTION_STRING=UseDevelopmentStorage=true` in the local web environment and create the
`photos` container in that emulator using Storage Explorer. The same `BlobPhotoStore` adapter is
used locally and in production. Without the setting, photo routes return `503 photo-unavailable`;
food lookup and meal logging continue. The fictional seed stores no photos and needs no emulator.

## Release checks for food and meals

Run `pnpm --filter ./shared test:integration` against a local SQL Server before release. It creates
and drops random sibling databases, tests the foundation-to-food migration, lookup precedence,
ten concurrent candidate picks, deletion snapshots, the viewer's SQL projection and seed events.
The food integration client reserves 12 connections so ten transactions can race on any runner;
Prisma's CPU-derived default pool can be smaller than the test's concurrency. Timeouts and service
retries are unchanged.
The seed adds nine fictional foods (two unverified imports, seven explicitly verified family foods)
and today's three meals totalling 102 g, plus four earlier occurrences of the lunch dish with
varied portions and recorded times. It refuses production and nonempty databases.

Build with `NEXT_PUBLIC_APP_VERSION=<tag> pnpm -r build`, then run
`pnpm --filter ./web test:e2e` with the same version and `DATABASE_URL`. The harness recreates only
the URL's `_e2e` sibling, registers passkeys through Chromium's virtual authenticator, and checks
360/1280 px flows. It disables food plugins and telemetry and uses a loopback Blob HTTP fake, so
no vendor API or Azure call runs. A fixed afternoon wall clock keeps the artboard meals in the past even on morning runs. The viewer's total is checked before the desktop verification
changes the library; meals created by the picker are deleted through the API after each flow.
The final check scans the entire standalone server log for seeded names, food names and barcode.
These suites stay in `release.yml`, never PR CI.

The web build runs `scripts/prepare-standalone.ts` after Next.js. It adds the generated Prisma
client/engine that pnpm's file trace misses and puts the static assets beside the server. It also
writes the root `server.js` that Static Web Apps starts, because the monorepo trace nests the app
under `web/`; without it the deploy ends in "Web app warm up timed out", and `deploy.sh` refuses
such a bundle. The bundle must contain no symlinks: the GitHub artifact between release jobs drops
them, and a copied pnpm link cannot find its package's dependencies (the server then dies on start
with "Cannot find module", which Static Web Apps also reports as a warm-up timeout). `.npmrc` sets
`node-linker=hoisted` for a flat `node_modules`, and the script fails the build if a link appears.
The browser suite copies the bundle with links dereferenced, as the deploy job receives it, into a
temporary directory outside the workspace and runs that root `server.js`, preventing missing
dependencies or assets from resolving through the checkout. Its photo check uploads generated pixels
through the real food-photo route, which runs `processPhoto` with the bundled native `sharp`, reads
both JPEGs from the Blob fake, asserts orientation, 1200×1600 and 320×320 dimensions and removal of injected EXIF/ICC, then verifies
food deletion removes both. **No photo fallback is enabled**: a missing native binary fails release.
This proves the Linux standalone artifact locally; the deployed Static Web Apps smoke remains the
release pipeline's responsibility.

## Meal curves and history statistics

Definitions live in [the v0.3.0 plan §5](superpowers/plans/2026-10-15-v0.3.0-meals-on-the-curve.md#5-the-statistics-spec-54-deterministic-and-in-code)
and the pure functions in `shared/src/stats/`. A meal chart spans one hour before to four hours
after; its peak (earliest on a tie) and time in range use only the three hours after the meal.
Time in range is time-weighted: a reading covers the interval to its successor only when that gap
is at most 15 minutes, clipped to the window and now. Longer gaps and a final reading without a
successor cover nothing. Week percentages divide by covered minutes; they are absent with no
coverage. Weeks start Monday in the space's timezone. Earlier dishes match the set of item names,
regardless of portions, retaining deleted foods' name snapshots.

For **“Ingen målinger i dette tidsrum”**, first check the meal's date/time and the space timezone:
the meal may predate the connected source or have no readings yet. Check the sensor and Dexcom app
for a sensor change or warm-up, then follow [the 35-minute alert checks](#the-35-minute-alert).
A sensor-change gap is uncovered time, never inferred time in range. Do not fill it with invented
readings. The existing alert concerns new readings across the poller, not whether an old meal's
window contains readings.

`release.yml` is unchanged in v0.3.0. Its existing commands discover the extended SQL integration
and browser suites; neither suite runs in PR CI. The seed checks fourteen local reading dates,
gap-free events and one event per reading/meal. SQL checks inclusive windows, dish matches after
food deletion and the week's two reading queries. At 360/1280 px, Playwright checks meal curves,
previous curves/table, portion editing with `meal.updated`, deletion, simpleMode detail, day/week
history and the viewer's meal-only responses and 403s. Edits and deletion are restored through the
API so the earlier release assertions retain their original data.

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
Lærke as a viewer, a day of fake readings) and prints one add-a-device link per person. It refuses to
run with `NODE_ENV=production` and on a database that already has a space.

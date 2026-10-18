# Nightscout adapter

`NightscoutSource` reads glucose from a person's own [Nightscout](https://nightscout.github.io/)
site through its REST API v1 (spec §3). `NightscoutPumpSource` reads the pump record from the same
kind of site (v0.7.0, [below](#pump-record)). Frejsi only reads: it never writes entries, treatments
or a profile, even when the credential would allow it.

## Calls

All three are `GET`, all sent by `sendNightscoutRequest` in `transport.ts`, which refuses any other
path or method before `fetch` is called (the allow-list is `READ_ONLY_ENDPOINTS`). `POST`, `PUT` and
`DELETE` on `treatments.json` are refused like any other write.

| Call                       | Used for                                                                         |
| -------------------------- | -------------------------------------------------------------------------------- |
| `/api/v1/entries/sgv.json` | `NightscoutSource.fetchSince(since)`: `find[date][$gte]=<since in ms>&count=<n>` |
| `/api/v1/treatments.json`  | `NightscoutPumpSource.fetchBolusesSince(since)`: see [Pump record](#pump-record) |
| `/api/v1/verifyauth`       | `probe()` on both                                                                |

`count` is `ceil(minutes / 5)` of the window, at most 288: 6 for the cycle's 30-minute window, 288
for the first run's day.

The site's address is part of the credential in Key Vault (`NightscoutCredential`: an `https` URL
without query, fragment or userinfo, plus exactly one of `token` or `apiSecret`). The database holds
only `{ type: "nightscout", secretRef }`.

## Authentication

The `api-secret` request header carries the SHA-1 hex digest of `apiSecret` (Nightscout's
`API_SECRET` convention), or the access `token` verbatim. It is never put in the URL, so no log,
proxy or telemetry sees it. Redirects are not followed (`redirect: "manual"`): a site that answers
3xx is misconfigured, and following it could hand the header to another host.

## Entries

`sgv` is always mg/dL in the API, whatever the site displays. `mmol = mgdlToMmol(sgv)`, one decimal.
`date` is milliseconds since the epoch and becomes the reading's `ts`. Entries without `sgv` or
`date`, or with a `type` other than `sgv`, are dropped; the result is newer than `since`, oldest
first, one per `date`.

| `direction`                                  | `Trend`             |
| -------------------------------------------- | ------------------- |
| `DoubleUp`                                   | `double-up`         |
| `SingleUp`                                   | `single-up`         |
| `FortyFiveUp`                                | `forty-five-up`     |
| `Flat`                                       | `flat`              |
| `FortyFiveDown`                              | `forty-five-down`   |
| `SingleDown`                                 | `single-down`       |
| `DoubleDown`                                 | `double-down`       |
| `RATE OUT OF RANGE`                          | `rate-out-of-range` |
| `NONE`, `NOT COMPUTABLE`, missing or unknown | `not-computable`    |

## Probe

`probe()` returns:

- `ok` when `verifyauth` answers `"OK"` (older sites) or an object with `canRead: true` (newer ones);
- `bad-credentials` for `UNAUTHORIZED`, `canRead: false` and HTTP 401 or 403;
- `unreachable` for a network error, a 30 s timeout, a body that is not JSON, a 3xx and any other
  status.

"ok" means the site is **readable with this credential or without one**: a site whose default role
already allows reading answers `canRead: true` to any header. A wrong token on such a site is not
caught by the probe, and its readings come through all the same.

## Pump record

`NightscoutPumpSource` implements `PumpSource` (`shared/src/pump/types.ts`). Its connection is its own:
the credential has the same shape as the glucose one and is stored as a version of `pump-<spaceId>`
by `source-connect` with `purpose: "pump"`; the database keeps `{ type, secretRef, connectedBy }`.

**The call.** `GET /api/v1/treatments.json?find[created_at][$gte]=<since, ISO>&find[eventType]=Combo
Bolus&count=<n>`, with the credential in `api-secret` as above. `Combo Bolus` is what tconnectsync
writes for every Tandem bolus; Temp Basal (hundreds a day), Sleep and every other treatment type are
filtered out in the query and never reach Frejsi. `n` is 200, or 1000 for a window longer than a
normal day plus three hours (a first run's 14 days, or a catch-up after a long outage).

**Paging.** Nightscout answers newest first. While a page comes back full, the next one adds
`find[created_at][$lt]=<oldest created_at seen>`, at most five pages. When the fifth is full too, the
adapter stops and logs `pump.page-cap` with the count; the next cycle reads the window again.

**The window** is the pump cycle's: `since = max(now − 14 d, min(now − 24 h, lastPumpAt − 3 h))`.
Tandem's upload lags by up to an hour and can arrive in a burst; a full day every cycle plus three
hours behind the newest stored bolus catches late records without a cursor that could skip one.

**The mapping.** Each record keeps five fields and nothing else:

| Record field    | `PumpBolus`                                                              |
| --------------- | ------------------------------------------------------------------------ |
| `pump_event_id` | `sourceId` (the idempotency key; a duplicate in one answer is one bolus) |
| `created_at`    | `ts` (UTC; `utcOffset` is ignored)                                       |
| `insulin`       | `units`, as recorded, at two decimals like the column                    |
| `notes`         | `kind`, below                                                            |
| `carbs`         | `carbs`, left out when 0 or absent                                       |

| `notes`                                | `kind`      |
| -------------------------------------- | ----------- |
| `Standard Bolus`, `BLE Standard Bolus` | `standard`  |
| `Extended Bolus`                       | `extended`  |
| `Automatic Bolus`                      | `automatic` |
| anything else, or missing              | `other`     |

**What is dropped.** A record without `pump_event_id`, with a `created_at` that does not parse, with
an `insulin` value that is not a number or lies outside 0–50, or that is not an object, is dropped;
one `pump.dropped` line carries how many. A record of another `eventType` is ignored without counting.
`glucose`, `enteredBy`, `utcOffset`, `_id` and every other key are never read beyond the parse.

**The probe** is the glucose adapter's: `verifyauth`, with the same verdicts. At connect time
`source-connect` then reads the last day of boluses and answers `recentBoluses`; zero with a working
token is the form's warning (tconnectsync not running, or another site).

## Errors and logs

`NightscoutError.code` is the HTTP status (`"401"`) or `Timeout`, `Network`, `UnexpectedShape`; the
message is the code. No log line or error message contains the address, the token or a response
body. Nightscout does not lock accounts, so there is no back-off: a 401 every cycle takes the space
to `disconnected` after three, like any failure.

## Fixtures

`fixtures/nightscout/` holds hand-written responses with fictional data, the treatments ones included. They have not been checked
against a live site; that happens when the owner provides one (v0.5.0 task 10). Until then the shapes
follow Nightscout's published API documentation.

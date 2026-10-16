# Nightscout adapter

`NightscoutSource` reads glucose from a person's own [Nightscout](https://nightscout.github.io/)
site through its REST API v1 (spec §3). Frejsi only reads: it never writes entries, treatments or a
profile, even when the credential would allow it.

## Calls

Both are `GET`, both sent by `sendNightscoutRequest` in `transport.ts`, which refuses any other path
or method before `fetch` is called (the allow-list is `READ_ONLY_ENDPOINTS`).

| Call                       | Used for                                                        |
| -------------------------- | --------------------------------------------------------------- |
| `/api/v1/entries/sgv.json` | `fetchSince(since)`: `find[date][$gte]=<since in ms>&count=<n>` |
| `/api/v1/verifyauth`       | `probe()`                                                       |

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

## Errors and logs

`NightscoutError.code` is the HTTP status (`"401"`) or `Timeout`, `Network`, `UnexpectedShape`; the
message is the code. No log line or error message contains the address, the token or a response
body. Nightscout does not lock accounts, so there is no back-off: a 401 every cycle takes the space
to `disconnected` after three, like any failure.

## Fixtures

`fixtures/nightscout/` holds hand-written responses with fictional data. They have not been checked
against a live site; that happens when the owner provides one (v0.5.0 task 10). Until then the shapes
follow Nightscout's published API documentation.

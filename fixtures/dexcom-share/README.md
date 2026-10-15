# Dexcom Share fixtures

Hand-written responses in the shapes the unofficial Dexcom Share protocol returns (the one Dexcom
Follow and `pydexcom` use). Nothing here was recorded from a real account: the account and session
ids are made-up GUIDs, the readings are a smooth made-up morning on 2026-10-15, and the timestamps
are plain epoch milliseconds in `Date(...)` wrappers as the protocol writes them.

| File                                | Call                                          | Shape                                                   |
| ----------------------------------- | --------------------------------------------- | ------------------------------------------------------- |
| `authenticate.json`                 | `General/AuthenticatePublisherAccount`        | a JSON string: the account id                           |
| `login.json`                        | `General/LoginPublisherAccountById`           | a JSON string: the session id                           |
| `latest-glucose-string-trend.json`  | `Publisher/ReadPublisherLatestGlucoseValues`  | newest first, `Trend` as `"Flat"`, `"FortyFiveUp"`, ... |
| `latest-glucose-numeric-trend.json` | same                                          | the older format, `Trend` as `0`-`9`                    |
| `session-not-valid.json`            | any call with a stale session (HTTP 500)      | `{ Code, Message }`                                     |
| `bad-credentials.json`              | authenticate with a wrong password (HTTP 500) | `{ Code, Message }`                                     |

These three calls are the whole allow-list in `shared/src/glucose/dexcom-share/transport.ts`; the
adapter refuses every other Share path (uploads, follower and alert changes) before sending anything,
so there are no fixtures for them and never will be.

`Value` is mg/dL. The adapter converts with mg/dL ÷ 18.016 to one decimal, so the six readings
are 6.2, 6.5, 7.0, 7.3, 7.7 and 8.0 mmol/L from oldest to newest.

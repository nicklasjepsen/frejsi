# Nightscout fixtures

Hand-written responses in the shapes the Nightscout REST API v1 returns. Nothing here was recorded
from a real site: the host is `example-ns.example.invalid`, the ids and device names are made up, and
the readings are a made-up run on 2026-10-15 from 10:00 UTC. The treatments are a made-up day of
boluses on the same date, with round units and carbs. `insulin` is Nightscout's own key for the
delivered units; Frejsi reads it only in the Nightscout adapter and stores it as `units`. They stay
hand-written until the owner's Nightscout site (v0.5.0 task 10) is used to verify the shapes.

| File                             | Call                           | Shape                                                                                                    |
| -------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `entries.json`                   | `GET /api/v1/entries/sgv.json` | newest first; one entry per `direction` word, a duplicate `date`, a `type: "mbg"`, no `sgv`, no `date`   |
| `entries-missing-direction.json` | same                           | three entries without `direction`: all `not-computable`                                                  |
| `entries-empty.json`             | same                           | `[]`                                                                                                     |
| `verifyauth-ok.json`             | `GET /api/v1/verifyauth`       | `message` is an object with `canRead: true`                                                              |
| `verifyauth-legacy-ok.json`      | same                           | `message` is `"OK"` (older sites)                                                                        |
| `verifyauth-unauthorized.json`   | same                           | `message` is `"UNAUTHORIZED"`                                                                            |
| `verifyauth-cannot-read.json`    | same                           | `message` is an object with `canRead: false`                                                             |
| `treatments-combo-bolus.json`    | `GET /api/v1/treatments.json`  | newest first; one of each `notes` value, a duplicate `pump_event_id`, a Temp Basal row, carbs and none   |
| `treatments-malformed.json`      | same                           | one good bolus, then a string `insulin`, `insulin` 75, an unparseable time, no `pump_event_id`, a string |
| `treatments-empty.json`          | same                           | `[]`                                                                                                     |

`sgv` is mg/dL; the adapter converts with mg/dL / 18.016 to one decimal. The adapter, the endpoints,
the `api-secret` header and the direction map are described in
`shared/src/glucose/nightscout/README.md`. "ok" from `verifyauth` means readable with this credential
or without one.

The three read calls are the whole allow-list in `shared/src/glucose/nightscout/transport.ts`; there
are no fixtures for writes and never will be.

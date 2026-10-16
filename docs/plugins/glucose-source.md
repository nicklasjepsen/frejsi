# Writing a glucose source

A glucose source is where a space's readings come from. Dexcom Share and Nightscout exist, and typed-in
finger-prick values (`manual`) need no adapter. Read [architecture.md](../architecture.md) first, and
[CONTRIBUTING.md](../../CONTRIBUTING.md) for how a pull request is reviewed.

In short: a glucose source is one folder, a `GlucoseSourceType` value, a `GlucoseSourceConfig`
variant, a credential schema, one dispatch line in `poller/src/sources.ts` and in `ADAPTERS`, two
message keys and a `SourceCard`.

## The contract

`GlucoseSource` is in `shared/src/glucose/types.ts`:

- `fetchSince(since)`: the readings newer than `since`, oldest first. A `Reading`
  (`shared/src/schemas/glucose.ts`) has a `ts` (ISO), `mmol` with one decimal and a `trend`. There is
  no way to build a reading without its time: a glucose value never travels or renders without it.
  Map the vendor's units and trend words to these; `shared/src/glucose/units.ts` converts mg/dL.
- `probe()`: checks a credential without storing anything. Return `ok`, `bad-credentials` or
  `unreachable`; never throw for a bad login. After `ok`, `source-connect` calls `fetchSince` for
  the last day on the same instance and reports the count, so keep the session a probe opened
  rather than logging in again. Log the service's own refusal code (never the credential) through
  the `log` option: it is what tells a wrong password from a locked account in App Insights.
- **Read-only.** Frejsi never writes to a glucose service: no uploads, no follower or alert changes,
  even when the credential would allow it. Your transport carries an allow-list of the methods and
  paths it may call and refuses anything else before `fetch` is called (see `READ_ONLY_ENDPOINTS` in
  `shared/src/glucose/nightscout/transport.ts`).

The source only returns readings. Storing them, the sequence number, the live event and the failure
counting are the poll cycle's (`shared/src/glucose/poll-cycle.ts`); your adapter never touches the
database and never calls `emit()`.

## The steps

1. **Open an issue** with the `plugin:glucose-source` label: which service, which API, how it
   authenticates.
2. **Add the type to the schema** in `shared/src/schemas/glucose.ts`: the value in
   `GlucoseSourceType`, a variant of `GlucoseSourceConfig` (`{ type, secretRef }` plus anything that
   is not secret, like a region), a variant of `ConnectSourceRequest`, and a credential schema for
   what goes to Key Vault. The database holds only the config; anything that locates or opens the
   account is part of the credential (Nightscout's address is, so the database does not say where a
   person's glucose history is).
3. **Create the folder** `shared/src/glucose/<id>/`, following `shared/src/glucose/nightscout/`:
   - `protocol.ts`: paths, request shapes and the pure mapping from a response to `Reading`s.
   - `transport.ts`: sends the requests, carries the allow-list, never follows a redirect with a
     credential attached.
   - `credential.ts`: parse and serialise the credential.
   - `source.ts`: the class implementing `GlucoseSource`, with `fetch` injected. No global `fetch`
     inside the folder.
   - `index.ts`, `README.md` (calls made, authentication, units, error codes, what is and is not
     verified against a live service) and `lint-boundaries.test.ts`.
     Export what the poller needs from `shared/src/index.ts`.
4. **Wire the poller** in two places, and let the compiler lead you: both are typed over every polled
   `GlucoseSourceType`, so a new type without an adapter fails to compile.
   - `poller/src/sources.ts`: the branch in `createSourceFactory` that builds your adapter from the
     credential in Key Vault.
   - `poller/src/source-connect-handler.ts`: one entry in `ADAPTERS` (the probe at connect time) and
     one case in `serializeSecret` (what is stored as `glucose-<spaceId>`).
     These two files are the only places the real `fetch` reaches a glucose adapter.
5. **Add the lint rule.** In `eslint.config.js`, put the vendor's host and path strings into a
   `no-restricted-syntax` selector like `dexcomHost` and `nightscoutProtocol`, add it to the rules
   that apply to every file and to the other adapters' blocks, and add a `frejsi/boundaries/<id>`
   block for your own folder that leaves it out. Your `lint-boundaries.test.ts` proves it on probe
   files, as `shared/src/glucose/nightscout/lint-boundaries.test.ts` does.
6. **Wire the web app.** The Settings route
   `web/src/app/api/spaces/[spaceId]/source/route.ts` forwards the connect request to the poller's
   `source-connect` function and stores `{ type, secretRef }` on success; add your type to the config
   it builds. `web/src/components/settings/SourceCards.tsx` renders one card per `GlucoseSourceType`
   value, so your card appears by itself; a source that needs a login links to a form, and
   `web/src/components/settings/ConnectSourceForm.tsx` is where its fields go.
7. **Add the copy** in both languages in the same commit: `web/messages/da/source.json` and
   `web/messages/en/source.json` get `<id>.name` and `<id>.description` (the card), and
   `settings.json` in both gets the form's labels and errors. Danish copy reads like a kind nurse,
   plain and unhurried; the form never prints the credential back.
8. **Write the fixtures** in `fixtures/<id>/`: hand-written, fictional, round numbers, in the shapes
   the vendor documents. Cover a few readings (every trend word once), an empty answer, a missing
   field, a refused credential and a service that does not answer. Add a README saying they are not
   recorded from a real account.
9. **Test with no network.** `source.test.ts` serves the fixtures through a recording `fetch` and
   asserts the readings, the probe results, that nothing outside the allow-list is ever requested,
   and that neither the credential nor the address appears in any log line or error message. Add
   tests for the poller wiring beside the existing ones in `poller/src/`. Add a route test that a
   viewer is refused (`403`) before anything is sent.

## Rules your plugin keeps

- Read-only, on an allow-list.
- Every reading carries its timestamp; the UI renders it with its age.
- The credential lives in Key Vault only: not in the database, not in a log line, an error message,
  a URL or a fixture. A token goes in a header, not the query string.
- A `viewer` never receives glucose; the existing routes already enforce it.
- No raw readings to an AI model; your adapter has nothing to do with AI.
- Nothing Danish hard-coded; the unit and the time zone come from the space.
- No insulin units, ratios, corrections or suggestions anywhere.

## Pull request checklist

- [ ] An issue with the `plugin:glucose-source` label, linked with `Closes #n`
- [ ] `GlucoseSourceType`, `GlucoseSourceConfig`, `ConnectSourceRequest` and a credential schema
- [ ] `shared/src/glucose/<id>/` with transport allow-list, README and boundary test
- [ ] The dispatch in `poller/src/sources.ts` and `poller/src/source-connect-handler.ts`
- [ ] The lint rule for the vendor's strings in `eslint.config.js`
- [ ] The Settings route and form, `da` and `en` copy
- [ ] Fixtures in `fixtures/<id>/`, fictional, with a README
- [ ] Tests for readings, probe, allow-list, no credential in logs, viewer `403`
- [ ] `## Docs` lists the paths changed
- [ ] `pnpm -r typecheck && pnpm -r lint && pnpm -r test` is green
- [ ] Commits signed off (`git commit -s`)

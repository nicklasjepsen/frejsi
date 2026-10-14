# Frejsi — Design Spec

**Status:** sections 1–4 approved by the owner on 2026-10-14; section 5 (AI) approved in principle, the "ask an adult" flow is to be confirmed during UI design; sections 6–9 are not yet designed. This document is the design brief for the UI work (Claude Design) and the input to the implementation plan (`writing-plans`). Nothing has been implemented.

**Language:** all project communication, prompts, code, comments and docs are in English. The product UI ships in Danish first (`da`) with English (`en`) from day one.

---

## 0. Intent

Frejsi is a web app for one person with diabetes and the people around them. It answers two questions, fast, on a phone: *"how many carbs is this?"* and *"what did that meal do to my glucose?"*

It was started for a 9-year-old newly diagnosed with type 1 diabetes (Tandem pump, Dexcom G7) and her two households plus grandparents — but nothing in the model assumes a child. The same code serves an adult with their partner, or a person with no carers at all.

**Priorities, in order (owner, 2026-10-14):**

1. **Danish products and barcodes in one place**, together with the family's own dishes. Existing Danish apps have no barcode scanner; international apps have no rye bread.
2. **Usable by the person themselves, including a child** — pictures, big targets, few taps (`simpleMode`).
3. **Meals tied to the live glucose curve** — see what a meal did, learn pre-bolus timing. No Danish app does this.
4. It is also the owner's own project. That is a valid reason.

**Success in 3 months:** the child finds her lunchbox herself; adults scan in the supermarket; the owner opens a meal and sees the following three hours of glucose under it.

**Non-goals (deliberate):**

- **No insulin dosing.** Frejsi never computes, suggests or displays insulin units, ratios or corrections. Users look up carbs here and enter them in their pump/pen. Clinical and legal choice; enforced in code (see §5).
- Does not replace the CGM app or the pump app.
- No pump data in v1 (Tandem has no real-time API; must not block).
- No native apps. Web app (PWA) only.

---

## 1. Architecture and Azure resources

**Repository:** `github.com/nicklasjepsen/frejsi` — monorepo (`pnpm` workspaces):

```
web/      Next.js (App Router) — UI + API routes
poller/   Azure Function (Node 22) — glucose polling, timer every 5 min
shared/   types, validation schemas, domain logic shared by web and poller
infra/    Bicep + GitHub Actions deploy
docs/     specs, plans, UI brief, ADRs
```

**Hosting:** Azure, owner's company subscription (Proxus), **dedicated resource group `frejsi`** (West Europe), no other users or workloads in it. Domain `frejsi.jepsen.ninja`.

| Resource | Tier | Purpose |
|---|---|---|
| Static Web App | Standard | hosts Next.js and its API routes; custom domain |
| Function App | Consumption, Node 22 | the poller (timer functions can't run in SWA managed functions) |
| Azure SQL | **Basic (5 DTU)** — *not* serverless | all data; the poller would keep serverless awake, making it 5–6× dearer |
| Web PubSub | Free (→ Standard when needed) | live push to clients, one group per space |
| Blob Storage | Standard LRS | food photos (originals + thumbnails) |
| Key Vault | Standard | glucose-source credentials, AI provider keys; read via managed identity |
| Application Insights | — | one alert: no new reading for 35 min (sensor changes cause ~30 min gaps) |

Everything is IaC (Bicep) and deploys from GitHub Actions. Target running cost: ~50–80 DKK/month.

**Data flow:**

```
Dexcom Share (EU) ──5 min──▶ poller ──▶ SQL.readings ──▶ emit(reading) ──▶ Web PubSub ──▶ phones
                                                            ▲
phone ──▶ SWA (Next.js) ──▶ API routes ──▶ SQL.* ──▶ emit(...) ┘
                               │
                               └──▶ Open Food Facts / Frida (lookups, cached in SQL.foods)
```

---

## 2. Data model (Azure SQL, Prisma)

Core concept: a **space** is the circle around one person with diabetes. A user can belong to several spaces.

| Table | Key columns | Notes |
|---|---|---|
| `users` | `id, name, avatar, simpleMode, createdAt, lastSeen` | `simpleMode` is a per-person presentation setting (large picture-based UI), **not a role** |
| `spaces` | `id, name, subjectUserId, timezone, glucoseSource (json), sourceStatus, lastReadingAt, aiEnabled, aiProvider` | one per person with diabetes |
| `memberships` | `userId, spaceId, role` | roles: `owner`, `carer`, `viewer` (see below) |
| `invites` | `token, spaceId, role, name, forUserId?, createdBy, expiresAt (7 d), usedAt?` | `forUserId` set ⇒ "add a device" to an existing user |
| `passkeys` | `id, userId, credentialId, publicKey, counter, deviceName, createdAt` | WebAuthn |
| `foods` | `id, spaceId?, name, carbsPer100g, portions (json), barcode?, photoBlob?, origin, verified, verifiedBy?, createdBy, embedding (vector), updatedAt` | `spaceId = null` ⇒ shared cache. `origin`: `family \| off \| frida \| ai \| manual` |
| `meals` | `id, spaceId, ts, byUserId, totalCarbs, note?, bolusTs?, photoBlob?` | `bolusTs` entered by a carer; makes pre-bolus timing visible on the curve |
| `meal_items` | `id, mealId, foodId?, name, grams, carbs` | snapshot of name/carbs at the time (foods may change later) |
| `readings` | `spaceId, ts, mmol, trend, source` | PK `(spaceId, ts)`; clustered. Raw stream, never edited. ~105k rows/year/space |
| `events` | `spaceId, seq, type, payload (json), ts` | the live feed, source of truth for clients (see §3b) |

**Roles:**

- **owner** — manages the space, invites, removes, changes roles, deletes data
- **carer** — logs meals, creates/edits foods, verifies, sees the curve
- **viewer** — sees today's meals and carb totals; **no glucose** (intended for a teacher or after-school club)

The subject is a member of their own space: as `owner` if an adult, as `carer` with `simpleMode` if a child. Nothing in code checks age.

**Portions are first-class:** `portions: [{ label: "1 slice", grams: 45 }, { label: "½ slice", grams: 22 }]`. A child picks "1 slice", never "45 g". Weighing (grams → carbs) still exists.

**Verification:** anything that came from OFF, Frida, AI or free text is `verified: false` until a carer ticks it. In `simpleMode` only verified foods are shown (own space's foods + foods that person has eaten before). Adults see everything, with a clear "not checked" mark.

---

## 2b. Authentication and invitations

**Passkeys only.** No email, no passwords. First sign-in via an invitation link (or QR code shown on an owner's phone); after that Face ID / fingerprint. A 9-year-old has no email but has Face ID; grandparents have nothing to remember.

- `@simplewebauthn/server` in API routes; session = httpOnly cookie, 90 days.
- New phone ⇒ ask an owner for an "add device" link to the existing user. The only recovery path; always goes through an owner.
- Owners can list and remove any device on any user in the space.
- No SWA built-in auth (would force everyone to have a Microsoft/Google account; Apple sign-in needs a paid developer program).

**Invite flow:** owner taps *Invite* → name + role → link/QR (7 days, single use) → recipient opens it, sees "Hi Susanne, you've been invited to Freja's space", registers a passkey.

---

## 3. Glucose source and poller

**Interface** (the only thing the rest of the app knows):

```ts
interface GlucoseSource {
  fetchSince(since: Date): Promise<Reading[]>   // Reading = { ts, mmol, trend }
  probe(): Promise<"ok" | "bad-credentials" | "unreachable">
}
```

Adapters: `dexcom-share` (v1), `nightscout` (next — opens Frejsi to the Nightscout community), `manual` (finger-prick values, for people without a CGM). Each space has `glucoseSource: { type, region, secretRef }`; the credential lives in Key Vault as `glucose-<spaceId>`, never in the database.

**Dexcom Share adapter** — three calls:

1. `General/AuthenticatePublisherAccount` (username, password, Dexcom applicationId) → accountId
2. `General/LoginPublisherAccountById` → sessionId (lasts ~24 h; reused; renewed on `SessionNotValid`)
3. `Publisher/ReadPublisherLatestGlucoseValues?minutes=30&maxCount=6` → `[{ WT, Value (mg/dL), Trend }]`

EU endpoint `shareous1.dexcom.com`. The login is the **subject's** Dexcom account (the one the G7 app is signed into — the "publisher"), not a follower's. Share must be enabled on the subject's phone. mg/dL ÷ 18.016 → mmol/L, one decimal. This protocol is unofficial (the same one Dexcom Follow and `pydexcom` use); it has been stable for years, but we own the risk — hence the adapter boundary. The official Dexcom API is a possible adapter but has a 3-hour delay in the EU, which fails the real-time requirement.

**Poller** (Azure Function, timer `*/5`):

- For every active space: fetch the last 30 min, upsert on `(spaceId, ts)` — idempotent; overlaps and double runs are harmless.
- First run for a new space: `minutes=1440, maxCount=288` so the chart doesn't start empty.
- A failure in one space never stops the others. Three consecutive failures ⇒ `spaces.sourceStatus = "disconnected"` and owners see a banner ("Dexcom connection down since 14:05"). Polling continues.
- Random jitter 0–20 s per run.
- Each new reading is emitted as an event (§3b).
- Local CLI: `pnpm poll --once --space <id>` to run against a real account during setup.

**Tests:** adapter against recorded JSON fixtures; poller against a fake `GlucoseSource`.

---

## 3b. Live transport

Decision (owner, 2026-10-14): build it properly from the start — real-time push, not polling.

- **`events` is the source of truth.** Every write path (API routes and the poller) goes through one function `emit(spaceId, type, payload)` which (1) inserts the row with the next `seq` and (2) publishes it to Web PubSub group `space:<id>`.
- Event types in v1: `reading`, `meal.created`, `meal.updated`, `meal.deleted`, `food.created`, `food.verified`, `source.status`. Anything new that should be live is a new type — no new endpoints, no new client logic.
- **Client:** one hook, `useLiveFeed(spaceId)`. It calls `/api/spaces/:id/negotiate`, which issues a Web PubSub client token with `joinLeaveGroup` only for spaces the user is a member of — access is enforced by Web PubSub, not by the client. On connect and on every reconnect it fetches `/api/spaces/:id/events?since=<lastSeq>` so nothing is lost while iOS had killed the socket. If the socket is down, it polls the same endpoint every 30 s until it is back. Screens subscribe to the hook; they never fetch live data themselves.
- **Poller** publishes via the Web PubSub REST API with managed identity — no keys.
- Local dev: `awps-tunnel` so the whole chain runs on a laptop.
- A glucose value is always shown with its age ("6.2 ↗ · 3 min ago"), never bare.

---

## 4. Food lookup

One call, `lookup(spaceId, query | barcode)`, resolves in this order:

1. **The space's own library** (`foods.spaceId = space`) — always first, always on top
2. **Shared cache** (`foods.spaceId = null`, filled by earlier lookups across spaces)
3. **Open Food Facts** — barcode or free text, Danish products boosted; carbs per 100 g + manufacturer serving size when present
4. **DTU Frida** — generic foods ("rye bread", "potato, boiled", "apple"); imported as a static dataset at deploy time (Frida has no usable API)
5. **Manual** — "I know the number": name, carbs per 100 g or per portion, photo

Results from 3–5 are stored in `foods` with `origin` and `verified: false`.

**Source plugins:** `off` and `frida` implement one `FoodSource` interface; `usda`, `bls` (DE), `matvaretabellen` (NO) etc. can be added by others without touching the rest. This is the project's most important contribution hook.

**Photos:** family dishes get a photo (Blob Storage; thumbnails to the phone). This is what makes `simpleMode` work — a child recognises the lasagne by its picture, not its name.

**OFF contribution:** when a user corrects an OFF product, offer "send the correction to Open Food Facts" (their write API, app name "Frejsi"). From v1, always behind a question, never automatic.

---

## 5. AI *(approved in principle; confirm the "ask an adult" flow in UI design)*

**One interface, several providers.** `AiProvider` with `complete()`, `vision()`, `embed()`. Adapters: `anthropic` (default — Claude Sonnet 5.5 for everyday calls, Claude Fable 5.1 for the weekly insight), `azure-openai` (EU residency in your own tenant), `ollama` (local, free). Per space: AI on/off and which provider. Keys in Key Vault.

**Where AI is used — four places, not everywhere:**

1. **Search that understands food.** Free-text search uses embeddings (stored on `foods`; Azure SQL vector type), so "spagetti med kødsovs" finds "Pasta bolognese", "the brown bread" finds rye bread, and a child's spelling doesn't matter. Own library always ranks above cache and OFF. OFF's messy product names are normalised once at import ("SCHULSTAD DET GODE RUGBRØD 950G" → "Rugbrød, Schulstad Det Gode") with suggested portions — small model, cached forever.
2. **Natural-language and voice logging.** "Two slices of rye bread with cheese and an apple" → the model calls `lookup()` as a tool per item and returns a structured meal with portions, which the user confirms line by line. Voice via the Web Speech API on top.
3. **Photo → estimate.** Plate photo → `vision()` → `[{ name, grams, carbs, confidence }]`. Always `verified: false`, always labelled **"approx."**. In `simpleMode` the child sees the estimate marked "approx." and a button **"ask an adult"**, which pushes to carers; a carer can correct and tick from their phone. The photo is stored only if the user saves the dish.
4. **Insight — observation, never advice.** Statistics are computed deterministically in code: peak, time to peak, time in range 4–10 over the next 3 h, compared with the same dish last times. The model only *narrates*: "Pizza has peaked above 13 the last three times, about 2 hours after. Something to bring to the nurse." Weekly summary the same way, plus a generated "questions for the clinic" list.

**Hard rules (in code, not in the prompt):**

- AI never produces insulin units, ratios or "take X". The output schema has no such field; a test fails if dosing vocabulary appears in insight text.
- Everything AI has touched is unverified until a human ticks it.
- Raw readings are never sent to the model — only computed statistics. Photos and text are sent only when the user actively taps.
- Per-space daily cap on calls (e.g. 50) so a bug can't become a bill.

**Evals in the repo:** ~50 Danish meals with photos and known carb values, ~30 free-text messages with expected parses. Prompt changes run against them in CI; if accuracy drops, the build fails.

---

## 6. UI — *to be designed in Claude Design* (see `docs/ui-brief.md`)

Not designed yet. The brief lists personas, modes, screens and constraints.

## 7. Error handling and observability — *not yet designed*

Known requirements: source-disconnected banner for owners; never show a glucose value without its age; App Insights alert on missing readings; AI call cap; no PII in logs.

## 8. Testing — *not yet designed*

Known requirements: adapter fixtures, fake sources, AI evals in CI, a test asserting no dosing vocabulary, Playwright for the `simpleMode` flows.

## 9. Repo, licence, community

- **Licence: AGPL-3.0** (owner, 2026-10-14). Chosen so a hosted copy must publish its changes; the same terms Nightscout uses. Contributions under **DCO** (sign-off), no CLA.
- README speaks to "a person with diabetes and the people around them", never to one family. Seed data is fictional. No secrets, no real people in the repo.
- Nothing Danish is hard-coded: i18n (`da`, `en`), food sources as plugins, glucose sources as plugins, mmol/L and mg/dL.
- "Deploy your own" in 15 minutes: Bicep + one GitHub Action + `.env.example`. Docker Compose for non-Azure users is v2 — one deploy path must work before a second exists.
- `CONTRIBUTING.md`, architecture note, issues as roadmap.

---

## Appendix A — Alternatives considered

| Option | Why not |
|---|---|
| Nightscout as the engine, Frejsi as front-end | Runs a large Node + MongoDB app we'd use 10 % of; half the project would not be ours. Kept as a planned **adapter** instead. |
| Official Dexcom API | 3-hour delay in the EU; fails the real-time requirement. Possible adapter later. |
| Cosmos DB | Right when it was "one family, three containers"; wrong once users ↔ spaces ↔ roles became many-to-many. |
| Azure SQL serverless | The 5-min poller never lets it pause; Basic DTU is cheaper and always on. |
| Polling only (no websockets) | Rejected by owner: build it properly from the start; more live data is coming. |
| PolyForm Noncommercial | Would keep Frejsi out of the Nightscout/Loop community and out of public-sector procurement; CLA friction. AGPL already prevents closed hosted copies. |
| Forking an existing OSS project | None combines a food library + child-friendly UI + real-time CGM curve + carer roles. Nearest: Nightscout (glucose only), OpenNutriTracker (nutrition, Flutter, no diabetes), CarbCam (closed). |

## Appendix B — Reference material

- Dexcom Share protocol: `pydexcom` (PyPI) and `dexcom-share-api` (npm) — EU base `https://shareous1.dexcom.com/ShareWebServices/Services`
- Open Food Facts API v2 — `https://world.openfoodfacts.org/api/v2/product/<barcode>`; write API for contributions
- DTU Frida — `https://frida.fooddata.dk` (downloadable dataset)
- Azure Web PubSub — client negotiate + groups; `awps-tunnel` for local dev
- SimpleWebAuthn — `@simplewebauthn/server`, `@simplewebauthn/browser`

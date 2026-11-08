# App Privacy answers

The answers for App Store Connect → the app → **App Privacy**, matched to what the code collects
at the time of writing (`ios/App/RelaySync.swift`, `RelayClient` in FollowCore, the relay in
`poller/src/live/`, the `LiveSubscription` model in `shared/prisma/schema.prisma`). Apple's
definitions are at <https://developer.apple.com/app-store/app-privacy-details/>. The privacy policy
at `https://naensom.jepsen.ninja/privacy` must say the same things.

Re-check this file whenever the registration body (`LiveRegisterRequest` in `shared/src/schemas/`),
the `LiveSubscription` table or the app's network calls change. Apple's answers are part of the
listing: a change in what is collected needs new answers before the release that ships it.

## What leaves the phone, and where it goes

| From the phone                                                      | Kept where                                                                                 | For how long                                                      |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| Nightscout address and read-only token                              | Key Vault secret `live-<subscriptionId>`; the host name alone in `nightscoutHost`          | Until "Remove this phone", invalid push tokens, or 30 days unused |
| Push-to-start token, Live Activity push token, APNs device token    | `pushToStartToken`, `activityPushToken`, `deviceToken`                                     | The same                                                          |
| Unit, language, four thresholds, reminders on/off, APNs environment | `unit`, `language`, `*Mgdl`, `alertsOn`, `apnsEnvironment`                                 | The same                                                          |
| A device secret (made by the server, sent back on update)           | SHA-256 only, `deviceSecretHash`                                                           | The same                                                          |
| The client IP (on every HTTP request)                               | Only in the rate limiter's memory (`RateLimiter` in `register.ts`), never stored or logged | Ten minutes to an hour, in memory                                 |

What the relay derives and keeps: `lastReadingAt` (the time of the newest reading, not its value),
`lastAlertKind` and `lastAlertAt` (whether the last reminder was low, high or no new readings, and
when), `lastPushAt`, `activityStartedAt`, `failures`, `createdAt`, `lastSeenAt`.

What it does not keep: glucose values. The relay reads the site, puts the newest value in one push
to Apple and forgets it (`relay.ts`, `payloads.ts`). The logs carry the subscription id and outcome
codes only, never an address, token, value or IP (`log.*` calls in `register.ts` and `relay.ts`).
The app reads Nightscout directly for its own screen; those readings stay on the phone. The QR
scanner's camera frames are processed on the phone only.

A demo subscription (`isDemo`, address `demo`) stores no address and no token; its readings are
made up by `demo.ts`.

## The answers

**Do you or your third-party partners collect data from this app?** Yes.

Third-party partners here are processors acting for the app: Microsoft Azure (the relay, the
database, Key Vault, in West Europe) and Apple (push delivery). There is no third-party SDK in the
app: no analytics, no crash reporter, no ads (`ios/project.yml` has no package dependencies other
than FollowCore).

### Data types collected

- [x] **Health & Fitness → Health**
  - Why: the thresholds the user sets (low, high and the two urgent values), whether the last
    reminder was for a low or a high reading and when (`lastAlertKind`, `lastAlertAt`), and the
    time of the newest reading are health information about a person, kept on our server. The
    stored Nightscout token also gives the server access to that person's glucose readings, which
    it reads every few minutes and passes to Apple in pushes (not stored).
  - Linked to the user's identity: **Yes** (see "Linked or not linked" below).
  - Used for tracking: **No**.
  - Purposes: **App Functionality** only (the Live Activity updates and the reminders).
- [x] **Identifiers → Device ID**
  - Why: the APNs push-to-start token, the Live Activity push token and the device token for the
    reminders identify this phone's app to Apple's push service, and the server keeps them
    (`pushToStartToken`, `activityPushToken`, `deviceToken`). The subscription id the server
    assigns ties them together.
  - Linked: **Yes**. Tracking: **No**. Purposes: **App Functionality**.
- [x] **Other Data → Other Data Types**
  - Why: the Nightscout site's address and its read-only token. The address often contains a
    family's name, and the token opens the site's data. Kept in Key Vault, the host name also in
    `nightscoutHost` (for rate limiting and support).
  - Linked: **Yes**. Tracking: **No**. Purposes: **App Functionality**.

### Data types not collected

- [ ] Contact Info (name, email, phone, address): the app has no accounts and asks for none.
- [ ] Health & Fitness → Fitness: nothing.
- [ ] Financial Info, Location, Sensitive Info, Contacts: nothing.
- [ ] User Content (photos, audio, messages, customer support, other): the QR scanner reads the code
      on the phone and sends no image.
- [ ] Browsing History, Search History, Purchases: nothing.
- [ ] Identifiers → User ID: there is no user or account; the subscription id is per install and is
      declared under Device ID.
- [ ] Usage Data (product interaction, advertising data): no analytics in the app.
- [ ] Diagnostics (crash data, performance data, other): no crash or performance SDK. The relay's
      own operational logs (outcome codes per subscription id, in App Insights) are generated on the
      server and carry nothing from the phone beyond the subscription id already declared. Apple's own
      crash reports, which users opt in to share, are collected by Apple, not by us.
- IP address: not collected in Apple's sense. It is sent with each request and held only in memory
  for the rate limit, then discarded (Apple: data "sent to your servers then immediately discarded
  after servicing the request" need not be disclosed). Verify that App Insights keeps its default
  IP masking for the function app before relying on this (`poller/host.json` and the App Insights
  resource in `infra/`); if it ever stores client IPs, the answer changes.

### Tracking

**Does this app use data for tracking?** **No.** No data is combined with other companies' data
for advertising, and nothing is shared with a data broker. The app does not show the App Tracking
Transparency prompt, because it does not track.

### Advertising

No data is used for third-party advertising or for the developer's own advertising or marketing.
The only purpose answered anywhere is App Functionality.

## Linked or not linked

The brief for this kit said "health data linked to the device only, not to identity". App Store
Connect does not ask that question: it asks, per data type, whether the data is **linked to the
user's identity**, and Apple counts data as linked unless it was de-identified before collection,
and counts anything that is personal data under privacy law as linked. The relay keeps the health
fields next to push tokens and a Nightscout host name (which often names a family), so it is
personal data under the GDPR (pseudonymous, not anonymous), and the honest answer is **Linked:
Yes** for all three types. The label then reads "Data Linked to You: Health, Identifiers, Other
Data" and "Data Used to Track You: none".

Answering "Not linked" would need the relay to hold nothing that can be tied back to a person,
which it cannot do while it must reach one phone with one family's readings. The owner decides;
this file recommends Yes.

## Before submitting

- [ ] The privacy policy at `https://naensom.jepsen.ninja/privacy` is live and lists the same data,
      purposes, retention (removal in one tap, 30 days unused) and the server's region, and names
      Microsoft and Apple as processors.
- [ ] Nothing in the app or relay changed after this file's last check (see the top).
- [ ] App Insights IP masking checked (above).

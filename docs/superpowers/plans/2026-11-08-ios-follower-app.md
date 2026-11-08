# Nænsom for iPhone (formerly Frejsi) — a Nightscout follower with Live Activity and CarPlay

**Status:** Draft, 2026-11-08, from the owner's request in the project thread "Build own iOS glucose app with CarPlay". **Not approved yet.** The owner's decisions so far: build our own app instead of using Night Guard; other people (Freya's teachers, her mom, Susan, and later other families) install it from the App Store, not TestFlight; free at launch, a price may come later; the owner's Mac mini is the Mac for Xcode. §9 lists what is still open.

**Tags:** `ios-vX.Y.Z` (like `desktop-vX.Y.Z`; `release.yml` and the `vX.Y.Z` tags never touch it) · **Builds on:** `desktop/` (the Nightscout reader, read-only token, ages, ranges, arrows), the poller (Azure Functions timers), Key Vault, Azure SQL via Prisma · **Spec:** `docs/superpowers/specs/2026-10-14-frejsi-design.md` hard rules (age with every value, read-only sources, no insulin, no PII in logs).

Not in the first release: critical alerts that break through silent mode (they need a separate Apple entitlement; a later request); an Apple Watch app (the Live Activity already appears in the Watch Smart Stack); signing in with a Frejsi account (the app follows a Nightscout site, like `desktop/`); following more than one person; a price; anything about insulin, ever.

## 0. The core requirement

The reason for this app: Night Guard refreshes its Live Activity only while the app is open, because it updates the activity from the app itself and iOS rarely lets a closed app run. **This app's Live Activity must stay current with the app closed, swiped away, and the phone locked in a pocket or on a car mount.** That is why the activity is updated by Apple push from our server (§4), which iOS delivers to the Live Activity without starting the app. Nothing in the design may depend on the app running in the background. Stage 2 tests exactly this before anything else is built.

## 1. What the first release is

When `ios-v1.0.0` is approved in the App Store:

- **Anyone installs it from the App Store** and opens it once. They tap the token link the owner sends them (or scan its QR code, or type the Nightscout address and a `readable` token). After that it just runs: no expiring builds, updates arrive on their own.
- **The app shows the current glucose, always with its age**: value in the range colour, trend arrow, change since the last reading, "3 min siden", and a 3/6/12-hour curve. When the newest reading is older than 15 minutes the value goes grey and the age says so. mmol/L by default, mg/dL in settings; low/high thresholds for the colours only.
- **A Live Activity keeps it on the lock screen and in the Dynamic Island**, updated by push every time a new reading arrives in Nightscout, whether the app is open or not. It shows value, arrow, change and age; the age is a relative time iOS ticks forward itself, and the activity marks itself stale 15 minutes after the reading, so an old value never looks current.
- **It keeps going past Apple's 8-hour limit.** Shortly before an activity reaches 8 hours, the server ends it and starts a new one by push-to-start (iOS 17.2+), without anyone opening the app.
- **It shows in CarPlay.** iOS 26 puts an iPhone's Live Activities and widgets on the CarPlay screen. The activity declares the small supplemental family, which CarPlay and the Watch Smart Stack use, and is designed to read at a glance: big value, arrow, age, colour. No CarPlay app entitlement is needed (none of Apple's CarPlay categories covers health, so a CarPlay app would not be approved).
- **A simple low/high notification** (owner, 2026-11-08). When a new reading crosses the user's low or high threshold, the relay sends one time-sensitive notification: "Lav: 3,6 mmol/L · 2 min siden". Once per crossing, then again only after 30 minutes if it is still out of range, and once when the newest reading is more than 20 minutes old ("Ingen nye målinger i 20 min"). Each user turns it on or off and sets the thresholds. It respects silent mode and Focus like any notification, and the copy says so: it is a reminder, not a replacement for the CGM app's alarms.
- **Widgets** for the home screen, lock screen and CarPlay, as a backup: iOS limits how often widgets refresh, so they always show their age and go grey when stale.
- **Danish and English**, following the phone's language.
- **The words say what it is**: "Keep the CGM app and its alarms; this shows the glucose, it does not monitor it." In onboarding, in settings and in the App Store listing.

## 2. Layout

```
ios/                              the app, like desktop/: outside pnpm, own workflow, own tags
  project.yml                     XcodeGen definition; the .xcodeproj is generated, not committed
  Packages/FollowCore/            Swift package, no UIKit: Nightscout client, entries parsing, units, arrows,
                                  ranges, ages, staleness, the link format. `swift test` runs on Linux too.
  App/                            SwiftUI app: onboarding, main screen, curve, settings, da/en strings
  LiveActivity/                   widget extension: ActivityAttributes, lock screen, Dynamic Island, small family
  Widgets/                        WidgetKit widgets (home, lock screen, CarPlay)
  Tests/                          UI-free tests for the app's view models
  README.md                       build, sign, release; what the server does
poller/src/live-*.ts              the push relay (§4), one more set of functions in the existing function app
shared/prisma/                    LiveSubscription table (§5), one migration
.github/workflows/ios.yml         build and test on macOS runners; upload to App Store Connect on an ios-v* tag
```

Code is written on claude-agents (Linux): XcodeGen and `FollowCore` mean the project file and the logic are plain text and `swift test` runs there. The Mac mini is for what needs Xcode: builds, the Simulator, the CarPlay simulator, UI tests and screenshots. Claude runs it through a Claude Code Remote Control session on the Mac mini, so development is agentic end to end (owner, 2026-11-08). The owner's hands are needed only for signing in to his Apple ID in Xcode once, and an optional look on his own iPhone before App Review. CI builds and uploads on GitHub's macOS runners, so a release never depends on the Mac mini being on.

## 3. The app

- **Onboarding.** One screen: "Tap the link you were sent". The link is `https://frejsi.jepsen.ninja/follow#<base64url of {url, token}>`, a universal link that opens the app (and a page with the App Store link when the app is missing). The token is in the fragment, so it never reaches a web server log. Fallback: scan the QR code, or type address and token. "Test connection" reads `GET /api/v1/entries.json?count=1` before saving.
- **Storage.** Address and token in the Keychain, shared with the extensions through an app group. Nothing else leaves the phone except what §4 sends to our server.
- **Reading.** In the foreground the app reads Nightscout directly every 30 seconds around the expected next reading (newest reading + 5 min). In the background it relies on the Live Activity pushes and widget timelines; background app refresh is a bonus, never the thing that keeps the value current.
- **Live Activity switch.** On by default after onboarding. Turning it on registers with the server (§4) and starts an activity; turning it off ends it and unregisters.
- **Settings.** Unit, thresholds, Live Activity on/off, "Remove this phone" (ends everything and deletes the server's copy), about/privacy/support links, the disclaimer.

## 4. The push relay (server)

The only way to keep a Live Activity current while the app is closed is a server that sends Apple push updates. It runs as new functions in the existing poller function app, so it uses the same managed identity, Key Vault and App Insights.

- **`live-register` (HTTP).** The app sends the Nightscout address and token, the push-to-start token, the activity's push token when there is one, unit and thresholds. The server checks the token by reading one entry from that Nightscout, stores the token in Key Vault (secret `live-<subscriptionId>`), creates the subscription, and returns the subscription id and a random device secret the app keeps in the Keychain. Update and delete need that secret. Rate-limited per IP; an address must be `https`.
- **`live-poll` (timer, every minute).** Picks the subscriptions that are due: newest reading + 5 min 15 s has passed, then every minute until a new reading arrives, backing off to every 5 minutes after 20 minutes without one. Reads `entries.json?count=2` from each due site (two entries give the change), and when the newest reading is new, sends one `liveactivity` push to the activity token with `{ mgdl, direction, delta, readingAt }`, `stale-date` = reading + 15 min. Reads only, from an allow-listed `GET` path, like every Frejsi source.
- **The 8-hour restart.** When an activity is 7 h 45 min old, the relay sends an `end` push and then a push-to-start push with the current reading, and the app's new activity token arrives through the app's push-token observer on the next launch or background wake. If push-to-start fails, the activity ends at 8 h and the app starts a new one the next time it is opened; the app's main screen then says "Live Activity stopped, tap to restart".
- **Apple Push.** Token-based auth: one `.p8` key, in Key Vault, sent over HTTP/2 with Node's `http2`. The app sets `NSSupportsLiveActivitiesFrequentUpdates` because a reading every 5 minutes is 288 updates a day. Priority 10 for every new reading at first; the budget Apple actually gives is measured in stage 2 and the plan is adjusted (priority 5 for in-range readings) if updates get throttled.
- **Demo source.** A subscription whose address is `demo` gets a made-up, plausible curve from the relay itself. App Review uses it, and so can the Simulator. No real person's data in it.
- **Low/high notifications.** In the same `live-poll` pass, a new reading that crosses the subscription's threshold sends one `alert` push (interruption level `time-sensitive`), following the repeat rules in §1. The subscription keeps `lastAlertKind` and `lastAlertAt` for that.
- **Cleanup.** A subscription whose push tokens Apple reports as invalid, or that has not registered for 30 days, is deleted with its Key Vault secret.
- **Logs** carry the subscription id and outcomes, never the address, token or a value.

## 5. Data

One table, `LiveSubscription`: `id`, `deviceSecretHash`, `nightscoutHost` (for rate limiting and support, not the full URL), `tokenSecretRef`, `pushToStartToken`, `activityPushToken`, `activityStartedAt`, `unit`, `low`, `high`, `lastReadingAt`, `lastPushAt`, `alertsOn`, `lastAlertKind`, `lastAlertAt`, `failures`, `createdAt`, `lastSeenAt`. No reading history is stored: the relay keeps only the time of the newest reading. It is not tied to a Frejsi space; people who follow through the app are not Frejsi users.

This is still other families' health data passing through our server, so (GDPR, special-category data): a privacy policy before launch, the server in West Europe, only what §5 lists, deletion from the app in one tap and automatically after 30 days, and no values in logs.

## 5b. What it costs to run

Apple charges nothing per push or Live Activity update. The cost is the relay: per user about 290 pushes and 400–600 small Nightscout reads a day. One `live-poll` run a minute handles every due subscription in parallel, so that is about 43,000 runs a month in total, not per user, and well inside the Functions consumption plan's free grant up to hundreds of users. Tokens are cached in memory, so Key Vault reads are a few kroner a month. The SQL database already exists. Rough estimate: under 0.10 kr per user per month, and perhaps 50–100 kr a month in total at 1,000 users. The fixed cost is the developer account, 99 USD (about 700 kr) a year. A price later is about support and the owner's time, not running costs.

## 6. App Store

- **Category:** Medical. **Price:** free. **Age rating:** 4+.
- **Listing and app copy** say it shows data from your own Nightscout site, is not a medical device, makes no treatment decisions, and does not replace the CGM app and its alarms. Nothing about "monitoring while driving"; CarPlay is mentioned as "see it on the CarPlay screen".
- **Privacy policy and support pages** on `frejsi.jepsen.ninja` (static pages in `web/`), and the App Privacy answers: health data, linked to the device only, not used for tracking.
- **Review notes** point to the demo source: "Tap 'Try the demo' to follow made-up data."
- Apple usually reviews in one to a few days; a Medical app showing health data may get a question or two. Budget a week for the first approval.

## 7. Stages

Each stage is a PR (or a lane) with its own tests, and ends with something the owner can try.

1. **Accounts and keys (owner).** Join the Apple Developer Program (99 USD a year, §9 decision 2), create the app ID with the app group and push capability, the APNs `.p8` key and an App Store Connect API key. Claude walks through each step and puts the keys in Key Vault and GitHub secrets; none goes in the repo.
2. **Skeleton and the push test.** `ios/` with XcodeGen, `FollowCore` with the Nightscout reader and tests, a bare main screen and a bare Live Activity; a one-off script that sends a push to it. Claude runs it in the iOS Simulator on the Mac mini, which receives real sandbox pushes from Apple. The test is the Night Guard failure: start the activity, swipe the app away, lock the phone, and leave it for 9 hours while a script on the relay pushes every real reading from ns.jepsen.ninja. Pass means every reading reaches the lock screen within a minute of the push, across the 8-hour restart, with the app never opened. The script logs push time and Claude compares it with Simulator screenshots of the lock screen taken every minute. The same test runs once on the owner's iPhone before App Review, because Apple's update budget on a real phone can differ. Stages 3–6 start only when this passes.
3. **The app.** Onboarding with the link and QR, the main screen with curve and ages, settings, da/en, the stale states.
4. **The relay.** `LiveSubscription`, `live-register`, `live-poll`, the APNs sender, the 8-hour restart, the demo source, cleanup. Tests with recorded Nightscout and APNs fixtures.
5. **The Live Activity and widgets, finished.** Lock screen, Dynamic Island, the small family for CarPlay and Watch, the widgets. Checked in Xcode's CarPlay simulator by Claude; the owner sees it in the car when he next drives.
6. **Release.** `ios.yml`, privacy and support pages, the listing and screenshots, a few days of TestFlight on the owner's phone only, then submits to App Store review. `ios-v1.0.0` when approved; the teachers, Freya's mom and Susan install from the App Store.

## 8. Risks

- **Push-to-start after 8 hours** is the least proven part (iOS may decline to start an activity in some states). Stage 2 tests it first; the fallback is a clear "tap to restart" in the app.
- **Update budget.** If Apple throttles 288 pushes a day, some readings arrive late on the lock screen. Measured in stage 2; the age on the activity keeps it honest either way.
- **Nightscout upload lag.** The app can never be faster than the uploader (Dexcom → Nightscout); the age always shows how old it is.
- **App Review** may ask about medical claims. The copy in §6 is written to avoid them.
- **Licence.** Frejsi is AGPL-3.0, which conflicts with the App Store's terms for third-party distributors. The owner holds the copyright and can publish the App Store build himself; contributions to `ios/` from others then need their agreement to App Store distribution (a line in `CONTRIBUTING.md`), or `ios/` gets its own licence (§9, decision 4).

## 9. Decisions

Decided by the owner on 2026-11-08:

1. **Name.** The product is renamed to "Nænsom" (owner, 2026-11-08). The App Store name is "Nænsom"; the bundle ID uses the ASCII form, `ninja.jepsen.naensom` (extensions `.liveactivity`, `.widgets`), unless the naming work settles on another spelling first. Nothing is published under "Frejsi".
2. **Developer account.** Individual, on the owner's Apple ID. Enrolled 2026-11-08, waiting for Apple's activation.
3. **Alarms.** A simple low/high notification in the first release (§1, §4). No critical alerts yet.
4. **Where the code lives.** `ios/` in this repo, like `desktop/`, with the contributor line from §8.
5. **Who runs the code.** Claude, on the Mac mini through Remote Control, Simulator included. The owner signs in to Xcode once.

Still open: the plan's approval as a whole.

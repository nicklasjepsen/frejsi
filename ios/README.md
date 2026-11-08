# Nænsom for iPhone

A Nightscout follower for iPhone: the current glucose with its age, and a Live Activity on the lock screen, in the Dynamic Island and on CarPlay that stays current with the app closed, because our server updates it by Apple push. The plan is `docs/superpowers/plans/2026-11-08-ios-follower-app.md`; this folder is at **stage 2**: the skeleton and the push test (plan §7).

Like the rest of Nænsom it only reads, shows every value with its age, and never says anything about insulin. Keep the CGM app and its alarms; this shows the glucose, it does not monitor it.

## Layout

```
project.yml              XcodeGen definition; the .xcodeproj, Info.plists and entitlements are generated
Packages/FollowCore/     Swift package, no UIKit: Nightscout reader, units, arrows, ranges, ages,
                         staleness, the follow link, the Live Activity content state. Tests run on Linux.
App/                     the bare SwiftUI app: value with age, start the Live Activity, show push tokens
LiveActivity/            the widget extension: lock screen, Dynamic Island, small family (CarPlay, Watch)
Shared/                  compiled into both: GlucoseActivityAttributes, range colours
```

| What                     | Value                                                                         |
| ------------------------ | ----------------------------------------------------------------------------- |
| App                      | `Naensom`, bundle ID `ninja.jepsen.naensom`, display name Nænsom              |
| Live Activity extension  | `ninja.jepsen.naensom.liveactivity`                                           |
| App group                | `group.ninja.jepsen.naensom`                                                  |
| Team                     | `B32HGH682W`                                                                  |
| Minimum iOS              | 17.2 (push-to-start); the small family for CarPlay and the Watch needs iOS 18 |
| APNs key                 | ID `P9HBN8RRS3`, Key Vault secret `apns-key-p8`                               |
| Live Activity push topic | `ninja.jepsen.naensom.push-type.liveactivity`                                 |

**Colours.** Four thresholds colour the value and its arrow everywhere it is shown (app, lock screen, Dynamic Island, CarPlay, Watch): green from low to high inclusive, yellow between an urgent value and its target edge, red at or beyond urgent low or urgent high, grey when the reading is more than 15 minutes old. Defaults are Nightscout's (55 / 80 / 180 / 260 mg/dL, 3.1 / 4.4 / 10.0 / 14.4 mmol/L), replaced by the site's `settings.thresholds` from `GET /api/v1/status.json` when present, and the user can step each one in the app (`GlucoseThresholds` in FollowCore, saved by `ThresholdStore` in the app group `group.ninja.jepsen.naensom` so the extension reads them). Colours only, no alarms; the value, arrow and age are always shown.

`FollowCore` is a port of the desktop tray app's reader (`desktop/src/BgTray.Core`) with the same test cases, so both show the same value, arrow, change and age. It reads only `GET /api/v1/entries/sgv.json` (the endpoint the desktop app and the poller read) and `GET /api/v1/status.json` (the thresholds), with the token in the `api-secret` header, never in the URL, and refuses redirects and plain http.

## Test FollowCore (any machine)

```
cd ios/Packages/FollowCore
swift test
```

Without a Swift toolchain, Docker does it: `docker run --rm -v "$PWD":/pkg -w /pkg swift:6.1-noble swift test --scratch-path /tmp/build`.

## Build the app (Mac)

Needs Xcode 16 or newer and XcodeGen (`brew install xcodegen`).

```
cd ios
xcodegen generate
open Naensom.xcodeproj
```

Sign in to the Apple ID of team `B32HGH682W` in Xcode (Settings → Accounts) once; signing is automatic. The app ID, the app group and the push capability must exist in the developer account (plan §7, stage 1).

**Simulator builds from the command line need ad-hoc signing**, not none: `CODE_SIGNING_ALLOWED=NO` strips the entitlements, and without them `Activity.request` fails. Use

```
xcodebuild -scheme Naensom -destination 'platform=iOS Simulator,name=iPhone 17' \
  CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual build
```

**Known in the Simulator (first build, 2026-11-08):** the push-to-start token appeared, but the activity push token stayed "not yet" after starting an activity. Ad-hoc signing carries no `aps-environment` provisioning, so the Simulator may never get an activity token that way; the push test needs a build signed with the team's development profile (Xcode signed in), and a real iPhone if the Simulator still gives no activity token.

The app and the Live Activity use one language, the first of Danish or English in the phone's preferred languages (`Language.preferred` in FollowCore), so the lock screen's ticking age ("1 min, 25 sec ago" / "1 min. 25 sek. siden") and the app's "1 min ago" never disagree.

## The push test (stage 2)

The test that decides whether the app gets built: the Live Activity stays current with the app closed and the phone locked, across the 8-hour restart (plan §0, §7).

1. Build and run `Naensom` in an iOS 17.2+ Simulator (Debug, so tokens come from the APNs sandbox). Type the Nightscout address and a read-only token, wait for the value, tap **Start Live Activity**.
2. Read the two tokens from the Simulator's log (they are also on screen, with Copy):
   ```
   xcrun simctl spawn booted log stream --level info --predicate 'subsystem == "ninja.jepsen.naensom"'
   ```
   `activity push token: …` is the activity, `push-to-start push token: …` the restart.
3. Write the activity token to a file and start the relay script from the repo root:
   ```
   echo <activity token> > /tmp/activity-token
   NS_URL=https://<site> NS_TOKEN=<read-only token> APNS_KEY_FILE=<path to .p8> \
     pnpm --filter ./poller push-test --activity-token-file /tmp/activity-token \
     --push-to-start-token <push-to-start token> --csv push-test.csv
   ```
   Instead of `APNS_KEY_FILE`, `KEY_VAULT_URL` reads the key from Key Vault (`apns-key-p8`). `--help` lists every option.
4. Swipe the app away and lock the Simulator. The script reads Nightscout every 30 seconds and sends one `update` push per new reading. At 7 h 45 min it sends `end` to the activity and `start` to the push-to-start token. The new activity's token appears in the Simulator log; write it to the same file and the script picks it up on its next pass (until then it records `update-skipped`).
5. Take a lock-screen screenshot every minute (`xcrun simctl io booted screenshot`) and compare it with the CSV: `sent_at`, `event`, `reading_at`, `reading_age_s`, the value, and Apple's status, reason and id.

Pass: every reading reaches the lock screen within a minute of its push, across the restart, with the app never opened. Then the same on a real iPhone, because Apple's update budget there can differ.

The script logs outcome codes only; the address, the tokens and the values never reach the log. The CSV holds times and values and stays on the machine that ran it (`push-test*.csv` is ignored by git).

## What the stage-2 app is not yet

No onboarding, curve, settings or da/en strings (stage 3), no registration with a server (stage 4: the relay in `poller/`), no widgets (stage 5). The follow link (`https://naensom.jepsen.ninja/follow#…`) is parsed by `FollowCore.FollowLink`, but the universal link needs the associated domain, which comes with stage 3.

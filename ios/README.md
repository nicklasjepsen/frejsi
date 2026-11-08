# Nænsom for iPhone

A Nightscout follower for iPhone: the current glucose with its age, and a Live Activity on the lock screen, in the Dynamic Island and on CarPlay that stays current with the app closed, because our server updates it by Apple push. The plan is `docs/superpowers/plans/2026-11-08-ios-follower-app.md`; this folder is at **stage 3**: the app itself, on top of the stage-2 skeleton and push test (plan §7).

Like the rest of Nænsom it only reads, shows every value with its age, and never says anything about insulin. Keep the CGM app and its alarms; this shows the glucose, it does not monitor it.

## Layout

```
project.yml              XcodeGen definition; the .xcodeproj, Info.plists and entitlements are generated
Packages/FollowCore/     Swift package, no UIKit: Nightscout reader, units, arrows, ranges, ages,
                         staleness, the follow link, the Live Activity content state. Tests run on Linux.
App/                     the SwiftUI app: onboarding, main screen with curve, settings, relay registration,
                         reminders; da.lproj / en.lproj strings
LiveActivity/            the widget extension: lock screen, Dynamic Island, small family (CarPlay, Watch)
Shared/                  compiled into both: GlucoseActivityAttributes, range colours, thresholds and
                         settings in the app group, the app's language
scripts/check-strings.py every string key in both languages, none unused, nothing about insulin
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

## TestFlight

`ios/fastlane/Fastfile` has one lane, `beta`: it generates the project, takes the next build number (newest TestFlight build + 1), archives a Release build with automatic signing for team `B32HGH682W` (`-allowProvisioningUpdates`), exports it for the App Store and uploads it to TestFlight.

```
brew install fastlane xcodegen
cd ios
fastlane beta
```

It signs in to App Store Connect as the Apple ID signed in to Xcode, or, when `ASC_KEY_ID`, `ASC_ISSUER_ID` and `ASC_KEY_P8` (the key's PEM text) are set, with an App Store Connect API key, for CI later. Nothing secret is in the repo. The app record `ninja.jepsen.naensom` must exist in App Store Connect first.

Without an App Store Connect API key, fastlane asks for the Apple ID's password, and while the team has no registered devices automatic signing cannot make the development profile an archive starts with. `scripts/upload-testflight.sh <build-number>` avoids both: it archives unsigned, signs the app and the extension ad hoc with their entitlements, and lets `xcodebuild -exportArchive` re-sign for the App Store and upload as the Apple ID in Xcode. Pass one more than the newest build in TestFlight; build 1 (0.1.0) was the first, uploaded this way.

The version is `MARKETING_VERSION` in `project.yml` (0.1.0); the build number is `CURRENT_PROJECT_VERSION`, which the lane sets. `ITSAppUsesNonExemptEncryption` is false (HTTPS only, through Apple's APIs), so uploads skip the export-compliance question. The icon is a placeholder, a white N on green, written by `scripts/make-placeholder-icon.py` with no external assets; replace `App/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png` with the real one.

## The push test (stage 2)

The test that decides whether the app gets built: the Live Activity stays current with the app closed and the phone locked, across the 8-hour restart (plan §0, §7).

1. Build and run `Naensom` in an iOS 17.2+ Simulator (Debug, so tokens come from the APNs sandbox). Set it up with the address and a read-only token; the Live Activity starts by itself.
2. Copy the two tokens. They never go to the system log (it only says one arrived); a debug build shows them under Settings → Push tokens with **Copy**, and writes them to `push-tokens.json` in the app group container:
   ```
   cat "$(xcrun simctl get_app_container booted ninja.jepsen.naensom group.ninja.jepsen.naensom)/push-tokens.json"
   ```
   `activity` is the activity's token, `push-to-start` the restart's.
3. Write the activity token to a file and start the relay script from the repo root:
   ```
   echo <activity token> > /tmp/activity-token
   NS_URL=https://<site> NS_TOKEN=<read-only token> APNS_KEY_FILE=<path to .p8> \
     pnpm --filter ./poller push-test --activity-token-file /tmp/activity-token \
     --push-to-start-token <push-to-start token> --csv push-test.csv
   ```
   Instead of `APNS_KEY_FILE`, `KEY_VAULT_URL` reads the key from Key Vault (`apns-key-p8`). `--help` lists every option.
4. Swipe the app away and lock the Simulator. The script reads Nightscout every 30 seconds and sends one `update` push per new reading. At 7 h 45 min it sends `end` to the activity and `start` to the push-to-start token. On iOS 18 the start push asks for the new activity's own update token (`input-push-token`); it appears in `push-tokens.json` and on screen. Write it to the same file and the script picks it up on its next pass (until then it records `update-skipped`).
5. Take a lock-screen screenshot every minute (`xcrun simctl io booted screenshot`) and compare it with the CSV: `sent_at`, `event`, `reading_at`, `reading_age_s`, the value, and Apple's status, reason and id.

Pass: every reading reaches the lock screen within a minute of its push, across the restart, with the app never opened. Then the same on a real iPhone, because Apple's update budget there can differ.

The script logs outcome codes only; the address, the tokens and the values never reach the log. The CSV holds times and values and stays on the machine that ran it (`push-test*.csv` is ignored by git).

## The app (stage 3)

- **Onboarding** is one screen: "Tap the link you were sent". The follow link `https://naensom.jepsen.ninja/follow#<base64url {url, token}>` opens the app as a universal link (`applinks:naensom.jepsen.ninja` in `project.yml`; `onOpenURL` → `FollowLink.parse`). The other ways in: scan the link's QR code (AVFoundation, camera text in `App/*.lproj/InfoPlist.strings`), or type the address and a read-only token. **Test connection** reads one entry (`ReadingFeed.test`) and nothing is saved until it passes. The address and token go to the Keychain. A link for another site while the phone already follows one asks before replacing it.
- **Try the demo** follows made-up readings: `DemoCurve` in FollowCore, a pure function of time with no network (one reading every five minutes, `140 + 55·sin(2πt/10800) + 18·sin(2πt/2700 + 1)` mg/dL, `t` in Unix seconds), and the relay is registered with the url `demo`, so its demo source drives the Live Activity. App Review uses it (plan §6).
- **Main screen**: the value in its threshold colour with the arrow, the unit, the change since the previous reading and the age ("3 min siden"); grey with "Ingen nye målinger" / "No new readings" once the reading is more than 15 minutes old. Below it the 3/6/12-hour curve (Swift Charts): one dot per reading in its colour, the target range as a faint green band, the urgent values as faint dashed lines. In the foreground the app reads nothing until the next reading is due (newest + 5 min), then every 30 seconds until it arrives (`RefreshSchedule`); it fetches 12 hours once and then only the gap (`ReadingHistory`). When the Live Activity should run and does not (it ended after 8 hours, or was swiped away), the screen says **"Live Activity stopped, tap to restart"**.
- **The app updates its own Live Activity** with every reading it fetches while it is open, so the app and the lock screen never disagree; only with a reading newer than the one the activity shows (`LiveActivitySync.shouldReplace`), so a late local fetch never overwrites a newer state the relay pushed.
- **Settings**: unit (mmol/L default, mg/dL), the four colour thresholds in the shown unit, Live Activity on/off (on by default after onboarding; on starts an activity and registers its tokens, off ends it and tells the relay), **Start Live Activity automatically** (on by default, stored in the app group: at cold launch and on every return to the foreground the app reuses a running activity, keeping the newest and ending any others, or starts one when there is a reading and iOS allows Live Activities; `LiveActivitySync.autoStart` decides, and a new activity's push token goes to the relay), low/high reminders on/off (asks for notification permission, then sends the APNs device token), about with the privacy and support pages (`https://naensom.jepsen.ninja/privacy`, `/support`, pages come later), the disclaimer, and **Remove this phone** (ends the activity, `DELETE`s the relay's copy, clears the Keychain and app-group settings, back to onboarding; when the relay cannot be reached it offers to remove it from the phone only, and the relay deletes its copy after 30 days). Debug builds also show the push tokens there, with Copy.
- **Relay registration** (`RelayClient` in FollowCore, `RelaySync` in the app) follows the contract in `poller/src/live/`: `POST /api/live/register` at `RelayConfig.baseURL` creates the subscription (the device secret comes back once and goes to the Keychain with the subscription id) and updates it with `x-device-secret`; an update the relay no longer recognises becomes a new subscription. The app registers at launch, when it comes to the foreground (an unchanged registration at most every 15 minutes), and 1.5 s after any push token, unit, threshold (the user's or the site's) or switch changes. A failure that may pass (no network, a busy relay) is retried by itself, from 30 seconds doubling to 15 minutes. Debug builds send `apnsEnvironment: "sandbox"`, Release builds `"production"`. With the Live Activity off the relay gets no activity tokens; with reminders off, no device token.
- **Words**: every user-facing string is in `App/da.lproj/Localizable.strings` and `App/en.lproj/Localizable.strings`, looked up in the app's one language (`AppLanguage.text`), so a phone in neither Danish nor English gets English in the app and on the lock screen alike. `python3 scripts/check-strings.py` checks both files. The reminders are described as what they are: a reminder that follows silent mode and Focus, not a replacement for the CGM app's alarms.

**Follow-ups outside `ios/`:** the web side must serve `https://naensom.jepsen.ninja/.well-known/apple-app-site-association` with `applinks` for `B32HGH682W.ninja.jepsen.naensom` and the path `/follow` before tapping a link opens the app (until then the link opens Safari; QR and typing work). The associated-domains and time-sensitive-notification entitlements must be enabled for the app ID (automatic signing does it when Xcode is signed in).

## What the stage-3 app is not yet

No widgets and no finished Live Activity design (stage 5), no privacy and support pages (stage 6). The relay's side of registration is stage 4.

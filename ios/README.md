# Nænsom for iPhone

A Nightscout follower for iPhone: the current glucose with its age, and a Live Activity on the lock screen, in the Dynamic Island and on CarPlay that stays current with the app closed, because our server updates it by Apple push. The plan is `docs/superpowers/plans/2026-11-08-ios-follower-app.md`; this folder is at **stage 5**: the app itself (stage 3) on top of the stage-2 skeleton and push test, with the finished Live Activity and the home and lock screen widgets (plan §7).

Like the rest of Nænsom it only reads, shows every value with its age, and never says anything about insulin. Keep the CGM app and its alarms; this shows the glucose, it does not monitor it.

## Layout

```
project.yml              XcodeGen definition; the .xcodeproj, Info.plists and entitlements are generated
Packages/FollowCore/     Swift package, no UIKit: Nightscout reader, units, arrows, ranges, ages,
                         staleness, the follow link, the Live Activity content state, the widget
                         timelines. Tests run on Linux.
App/                     the SwiftUI app: onboarding, main screen with curve, settings, relay registration,
                         reminders; da.lproj / en.lproj strings
LiveActivity/            the widget extension's Live Activity: lock screen, Dynamic Island, small family
                         (CarPlay, Watch)
Widgets/                 the same extension's widgets (home screen, lock screen, StandBy, CarPlay), the
                         extension's @main bundle, and the text pieces both share
Shared/                  compiled into both: GlucoseActivityAttributes, range colours, thresholds,
                         settings and the newest reading in the app group, the Keychain, the app's
                         language, and the widgets' strings (da.lproj / en.lproj Widgets.strings)
scripts/check-strings.py every string key in both languages and both tables, none unused, nothing about insulin
```

| What                     | Value                                                                         |
| ------------------------ | ----------------------------------------------------------------------------- |
| App                      | `Naensom`, bundle ID `ninja.jepsen.naensom`, display name Nænsom              |
| Widget extension         | `ninja.jepsen.naensom.liveactivity` (the Live Activity and the widgets)       |
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

**The Mac mini** (set up 2026-11-08) has Xcode 27.2, the iOS 27.2 Simulator runtime, an iPhone 17 Simulator, and `xcodes`, XcodeGen, xcbeautify and fastlane from Homebrew. Over SSH its login keychain stays locked (`security` answers "User interaction is not allowed"), so gh's token and the Apple ID session `xcodes` keeps do not work from an SSH shell (gh gets a 401), and code signing should be expected to fail the same way. Sign-ins, signing and `git push` go through Terminal on the Mac or the Remote Control session. An SSH shell there is a non-login zsh without Homebrew on `PATH`: export `PATH=/opt/homebrew/bin:$PATH` first. `xcrun simctl bootstatus` returns before the home screen is drawn; wait until `xcrun simctl launch <udid> com.apple.Preferences` succeeds before taking a screenshot.

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

## App Store

`AppStore/` holds the submission kit: the listing in Danish and English (`listing.da.md`, `listing.en.md`), the notes for App Review (`review-notes.md`), the App Privacy answers matched to what the app and the relay collect (`app-privacy.md`), the screenshot list and how to capture it from the demo (`screenshots.md`), and the submission steps in order, with what needs the owner (`checklist.md`). Update them in the same PR as any change to what the app shows, sends or stores.

## The push test (stage 2)

The test that decides whether the app gets built: the Live Activity stays current with the app closed and the phone locked (plan §0, §7). Across the 8-hour restart that is the aim, not a pass condition (plan §9 decision 6).

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
   Instead of `APNS_KEY_FILE`, `KEY_VAULT_URL` reads the key from Key Vault (`apns-key-p8`). With `KEY_VAULT_URL` set, `NS_CREDENTIAL_SECRET=<secret name>` (a stored Nightscout credential such as a space's `pump-<spaceId>`) replaces `NS_URL` and `NS_TOKEN`, so the token is read by the script and never typed or shown. A TestFlight or App Store build gets its tokens from the production APNs host: add `--env production`. `--help` lists every option.
4. Swipe the app away and lock the Simulator. The script reads Nightscout every 30 seconds and sends one `update` push per new reading. At 7 h 45 min it sends `end` to the activity and `start` to the push-to-start token. On iOS 18 the start push asks for the new activity's own update token (`input-push-token`); it appears in `push-tokens.json` and on screen. Write it to the same file and the script picks it up on its next pass (until then it records `update-skipped`).
5. Take a lock-screen screenshot every minute (`xcrun simctl io booted screenshot`) and compare it with the CSV: `sent_at`, `event`, `reading_at`, `reading_age_s`, the value, and Apple's status, reason and id.

Pass: every reading reaches the lock screen within a minute of its push, with the app never opened. Then the same on a real iPhone, because Apple's update budget there can differ. Staying current across the restart is the aim but no longer a pass condition: past the 8-hour limit the activity may go stale, as long as it plainly shows that it is stale (owner, 2026-11-09; plan §9 decision 6).

The script logs outcome codes only; the address, the tokens and the values never reach the log. The CSV holds times and values and stays on the machine that ran it (`push-test*.csv` is ignored by git).

### First run on a real iPhone (2026-11-08/09)

The owner's iPhone with the TestFlight build, `--env production`, priority 10, run overnight from the Mac mini (23:31 to 07:45 CET), the APNs key read from Key Vault.

- **Delivery.** One `--once` push showed on the lock screen straight away (checked by the owner). Overnight Apple accepted all 93 pushes with 200: 91 `update`, then the `end` and the push-to-start `start`. No 4xx, 429 or 5xx. Updates went out every 5 minutes, typically 45 s after the reading. Nobody compared the phone with the CSV overnight, so whether iOS showed every update (the update budget, plan §8) is still unmeasured: a 200 means Apple accepted the push, not that the phone drew it.
- **Gaps come from upstream.** One 20-minute stretch had no pushes because Nightscout had no readings for 15 minutes and the next one arrived almost 6 minutes late. The ticking age on the lock screen covers it.
- **The restart ran on time** (7 h 45 min 12 s): Apple accepted the `end` and the push-to-start. **No update reached the new activity**, because the run was started with a fixed `--activity-token`. The tool retires that token at the restart and ignores it from then on (`poller/src/live/push-test-run.ts`), so it had no way to learn the new activity's token and wrote `update-skipped` for every later reading. Only `--activity-token-file` brings a new token in, and in stage 2 someone has to copy it from the app into that file. An unattended overnight run therefore cannot test updates after the restart; in stage 4 the app registers the new token with the relay itself (plan §4).
- **Stale shows.** 36 minutes after the last pushed reading the lock screen showed the value with its age, ticking with no push. Still to check on the phone: the grey stale look with the clock badge, and whether the activity on screen after the restart was the new one push-to-start began (the `end` push dismisses the old one at once, and the start push arrives with a "Restarted" alert).

Lessons for the next run:

- To cross the restart, start with `--activity-token-file` and be there to copy the new token into it, or stop the run before 7 h 45 min.
- Pass the Nightscout credential with `NS_CREDENTIAL_SECRET`, not `NS_TOKEN`: a token on a command line (for example `tmux new-session -e NS_TOKEN=…`) stays visible in the process list (`ps`) for the whole run.
- Run it in a `tmux` session under `caffeinate -dimsu`, so it survives the SSH session closing and the Mac staying awake is not left to its settings.

## The app (stage 3)

- **Onboarding** is one screen: "Tap the link you were sent". The follow link `https://naensom.jepsen.ninja/follow#<base64url {url, token}>` opens the app as a universal link (`applinks:naensom.jepsen.ninja` in `project.yml`; `onOpenURL` → `FollowLink.parse`). The other ways in: scan the link's QR code (AVFoundation, camera text in `App/*.lproj/InfoPlist.strings`), or type the address and a read-only token. **Test connection** reads one entry (`ReadingFeed.test`) and nothing is saved until it passes. The address and token go to the Keychain. A link for another site while the phone already follows one asks before replacing it.
- **Try the demo** follows made-up readings: `DemoCurve` in FollowCore, a pure function of time with no network (one reading every five minutes, `140 + 55·sin(2πt/10800) + 18·sin(2πt/2700 + 1)` mg/dL, `t` in Unix seconds), and the relay is registered with the url `demo`, so its demo source drives the Live Activity. App Review uses it (plan §6).
- **Main screen**: the value in its threshold colour with the arrow, the unit, the change since the previous reading and the age ("3 min siden"); grey with "Ingen nye målinger" / "No new readings" once the reading is more than 15 minutes old. Below it the 3/6/12-hour curve (Swift Charts): one dot per reading in its colour, the target range as a faint green band, the urgent values as faint dashed lines. In the foreground the app reads nothing until the next reading is due (newest + 5 min), then every 30 seconds until it arrives (`RefreshSchedule`); it fetches 12 hours once and then only the gap (`ReadingHistory`). When the Live Activity should run and does not (it ended after 8 hours, or was swiped away), the screen says **"Live Activity stopped, tap to restart"**.
- **The app updates its own Live Activity** with every reading it fetches while it is open, so the app and the lock screen never disagree; only with a reading newer than the one the activity shows (`LiveActivitySync.shouldReplace`), so a late local fetch never overwrites a newer state the relay pushed.
- **Live Activity shows** (Settings; `Shared/LiveActivityLayout.swift`): the trend arrow, the change since the last reading and the unit can each be turned off, and the age read in words ("5 min, 3 sec ago") or as a ticking timer ("5:03"). The value and its age are always shown. The choices live in the app group, the extension reads them each time it draws, and the app redraws running activities when one changes. "Remove this phone" resets them.
- **Invite someone** (Settings, under the followed site; `App/InviteView.swift`, `NightscoutInvites` in FollowCore): the owner adds a Nightscout token with the admin role once; it stays in the app's own Keychain group (not the widgets'), tied to that site, and is never sent to the relay. For each person the app then creates a subject named `naensom <name> #<random>` with only the `readable` role and the note "Created by nænsom" (`POST /api/v2/authorization/subjects`), and sends that subject's access token as a follow link (share sheet) or QR code. The screen lists only those read-only subjects (marked by the note, or by the name's shape on Nightscout releases that do not send notes in the subject list), and **Remove** deletes one (`DELETE …/subjects/<id>`), so that person's app stops at once; the owner's own subjects are never shown or touched. A phone without an admin token (everyone invited) sees only the request for one, so it cannot invite. This is the one write to Nightscout (owner, 2026-11-09; CLAUDE.md hard rules).
- **Settings**: unit (mmol/L default, mg/dL), the four colour thresholds in the shown unit, Live Activity on/off (on by default after onboarding; on starts an activity and registers its tokens, off ends it and tells the relay), **Start Live Activity automatically** (on by default, stored in the app group: at cold launch and on every return to the foreground the app reuses a running activity, keeping the newest and ending any others, or starts one when there is a reading and iOS allows Live Activities; `LiveActivitySync.autoStart` decides, and a new activity's push token goes to the relay), low/high reminders on/off (asks for notification permission, then sends the APNs device token), about with the privacy and support pages (`https://naensom.jepsen.ninja/privacy`, `/support`, served by `web/`), the disclaimer, and **Remove this phone** (ends the activity, `DELETE`s the relay's copy, clears the Keychain and app-group settings, back to onboarding; when the relay cannot be reached it offers to remove it from the phone only: the subscription id and device secret then wait as a pending removal in the app's own Keychain access group, apart from the active registration, and the app sends the `DELETE` again at every launch, background launch, return to the foreground and accepted registration, at most every 30 seconds, until the relay answers 204, 401 or 404 (`PendingUnregisters` in FollowCore, `App/PendingUnregisterSync.swift`); the relay also deletes it by itself after 30 days without delivery). Debug builds also show the push tokens there, with Copy.
- **Relay registration** (`RelayClient` in FollowCore, `RelaySync` in the app) follows the contract in `poller/src/live/`: `POST /api/live/register` at `RelayConfig.baseURL` creates the subscription (the device secret comes back once and goes to the Keychain with the subscription id) and updates it with `x-device-secret`; an update the relay no longer recognises becomes a new subscription. The app registers at launch, when it comes to the foreground (an unchanged registration at most every 15 minutes), and 1.5 s after any push token, unit, threshold (the user's or the site's) or switch changes. A failure that may pass (no network, a busy relay) is retried by itself, from 30 seconds doubling to 15 minutes. Debug builds send `apnsEnvironment: "sandbox"`, Release builds `"production"`. With the Live Activity off the relay gets no activity tokens; with reminders off, no device token.
- **Words**: every user-facing string is in `App/da.lproj/Localizable.strings` and `App/en.lproj/Localizable.strings`, looked up in the app's one language (`AppLanguage.text`), so a phone in neither Danish nor English gets English in the app and on the lock screen alike. `python3 scripts/check-strings.py` checks both files. The reminders are described as what they are: a reminder that follows silent mode and Focus, not a replacement for the CGM app's alarms.

**The web side** (`web/src/app/.well-known/apple-app-site-association`, `follow`, `privacy`, `support`; copy in `web/src/lib/ios-pages/messages/`) serves `https://naensom.jepsen.ninja/.well-known/apple-app-site-association` with `applinks` for `B32HGH682W.ninja.jepsen.naensom` and `/follow*`, as `application/json` with no redirect, so a tapped link opens the app once that web change is released with a version tag (until then the link opens Safari; QR and typing work). Without the app, `/follow` is a static page in Danish and English that says to install Nænsom and tap the link again; it runs no script, so nothing reads the fragment. `/privacy` and `/support` are the pages Settings links to, in the browser's language (`?lang=da` or `?lang=en` picks one). The associated-domains and time-sensitive-notification entitlements must be enabled for the app ID (automatic signing does it when Xcode is signed in).

## The Live Activity and widgets (stage 5)

**One extension.** The widgets live in the Live Activity's extension (`NaensomLiveActivity`, bundle ID `ninja.jepsen.naensom.liveactivity`), not a separate `.widgets` target: one extension may host both, and it keeps one app ID, one profile and one signing step in `scripts/upload-testflight.sh`. `Widgets/NaensomWidgetBundle.swift` is the `@main` bundle; WidgetBundleBuilder allows no `if #available`, so the iOS 18 check for the small family stays inside `GlucoseLiveActivity`.

**Widgets** (`Widgets/GlucoseWidget.swift`): home screen small and medium (the small one is also what StandBy shows and what iOS 26 puts on the CarPlay screen), and on the lock screen inline, round and rectangular. Each shows the value with its arrow in the threshold colour, and its age, ticking by itself in the app's language (`Text(_, style: .relative)` where there is room, a ticking m:ss in the round and inline ones). Fifteen minutes after the reading the value goes grey, a clock badge appears and, where there is room, "No new readings"; on the lock screen iOS draws accessory widgets in one tint, so the badge and words carry it there. Before there is any reading: "No data yet · Open Nænsom". The demo shows the demo curve, labelled "Demo".

**Where the reading comes from.**

- The app writes the newest reading and the one before it (`GlucoseSnapshot` in FollowCore, `GlucoseSnapshotStore` in the app group) whenever a fetch brings a newer one, the same path that updates the Live Activity, and asks WidgetKit to reload (`App/WidgetSync.swift`); also when the unit or thresholds change. Following another site or "Remove this phone" clears it.
- When iOS asks for a timeline and the next reading is due (the newest is five minutes old, or there is none), the widget reads the site itself, with FollowCore's client: the same `GET /api/v1/entries/sgv.json`, the read-only token in the `api-secret` header, https only. For that the address and token are in the app group's Keychain access group (on iOS an app group is also an access group; no extra entitlement); the app copies a stage-3 credential there at launch (`KeychainStore.shareWithExtension`, which only adds and never deletes first). Should iOS refuse the shared group, the credential is saved in the app's own group as before: the app keeps working and the widget shows the app's snapshot without reading the site. On the Mac, check that a widget reads the site with the app closed; if it never does, add a `keychain-access-groups` entitlement to both targets. The relay's subscription id and device secret stay in the app's own group. Before the first unlock after a restart the Keychain is closed and the widget shows the stored snapshot.
- A timeline (`WidgetTimeline` in FollowCore, tested) is the reading now and the same reading grey from its stale moment (reading + 15 min, the Live Activity's `staleDate`), and asks for the next one a minute after the next reading is due (reading + 6 min), every 5 minutes while one is overdue and every 15 once the newest is 20 minutes old. iOS gives a widget a limited number of refreshes a day and may come later than asked; the grey entry and the ticking age keep it honest. The demo's timeline is the next hour of demo readings, one entry every five minutes.

**Glanceability** (Live Activity): the value and arrow are the largest thing everywhere and bold. The small family (CarPlay, Watch Smart Stack) shows only the value with its arrow (44 pt, shrinking to fit) and the age under it, without unit or change. The lock screen has the value at 50 pt with the unit under it, the change and the age on the right, and "No new readings" when stale. The expanded Dynamic Island has the value at 40 pt on the left and the change and age on the right; the compact island the value with its arrow and a ticking m:ss; the minimal one the arrow in the range colour, or the clock badge once stale, so an old trend never looks current.

**Not compiled on Linux.** The SwiftUI and WidgetKit code is checked by the Xcode build on the Mac; check it there in the Simulator and the CarPlay simulator (home screen, lock screen, StandBy, CarPlay), including the grey state (follow a site, wait 15 minutes with no new reading, or use a reading that is already old).

## What is not here yet

The privacy and support pages are on the web side (above); the App Store listing and submission are stage 6.

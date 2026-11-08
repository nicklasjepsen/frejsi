# Notes for App Review

Paste the fenced text into App Store Connect → the version → **App Review Information → Notes**.
Set **Sign-in required** to off: the app has no accounts. The contact fields (first and last
name, phone, email) take the owner's details in App Store Connect; they are not written here.

Keep the notes in English. They state facts the reviewer can check in the build; update them when
the app changes (a new screen, a new push, a feature that moves).

```text
WHAT NÆNSOM IS
Nænsom shows the glucose readings from the user's own Nightscout site, on the iPhone, in a Live Activity on the lock screen and in the Dynamic Island, and (through the Live Activity) in the Apple Watch Smart Stack and on the CarPlay screen. It is meant for family members and carers who follow a person with diabetes.

Nightscout is a free, open-source web app that people with diabetes run themselves (their own website). Their CGM uploads a glucose reading to it every five minutes. The data on a Nightscout site belongs to its owner; Nænsom only reads it, with a read-only token the site's owner creates and shares in a link. Nænsom never writes to the site.

HOW TO TRY IT WITHOUT A NIGHTSCOUT SITE
No account or sign-in is needed.
1. Open the app. On the first screen, tap "Try the demo" (Danish: "Prøv demoen").
2. The app now follows made-up readings: a smooth curve between about 3.7 and 11.8 mmol/L (67 to 213 mg/dL), one reading every five minutes. The phone draws them from a formula, and our server sends the same made-up readings to the Live Activity by push. No real person's data is used.
3. The Live Activity starts on its own. Lock the phone or swipe the app away: the Live Activity on the lock screen and in the Dynamic Island keeps updating every five minutes, because our server pushes each new reading.
4. Settings (the gear button) shows the unit (mmol/L or mg/dL), the four colour thresholds, the Live Activity switches, the low and high reminders, the privacy and support links, the disclaimer, and "Remove this phone".
5. To see a reminder: turn on "Low and high reminders" in Settings and allow notifications. The demo curve crosses the default high threshold (10.0 mmol/L) and low threshold (4.4 mmol/L) within each three-hour cycle, and the server then sends one notification.

The app follows the phone's language: Danish if Danish comes before English in the phone's preferred languages, otherwise English.

HEALTH DISCLAIMER
Nænsom is not a medical device. It shows readings; it does not diagnose, does not monitor, and makes no treatment decisions. It gives no treatment advice of any kind and never calculates insulin. The app says, on the first screen, in Settings and in the store listing: "Keep the CGM app and its alarms. Nænsom shows the glucose; it does not monitor it." Every value is shown with its age ("3 min ago"), and turns grey with "No new readings" when the newest reading is more than 15 minutes old, so an old value never looks current. The colours (green, yellow, red, grey) follow thresholds from the user's Nightscout site or the user's own settings; they are colours only.

WHY THE LIVE ACTIVITY USES FREQUENT UPDATES (NSSupportsLiveActivitiesFrequentUpdates)
A CGM produces a new reading every five minutes, which is 288 readings a day. The Live Activity is the main way people use the app: it must show the newest reading with the app closed and the phone locked. The app does not run in the background to do this; our server reads the Nightscout site and sends one ActivityKit push per new reading, and nothing more often than that. Before an activity reaches Apple's 8-hour limit, the server ends it and starts a new one with a push-to-start push, so the lock screen keeps the current reading. The user can turn the Live Activity off in Settings at any time.

WHY TIME-SENSITIVE NOTIFICATIONS
The optional low and high reminders (off until the user turns them on) say that a reading went below the user's low or above the user's high threshold, or that no new readings have arrived for 20 minutes. Such a message is relevant now, not later, so it is marked time-sensitive. It is not a critical alert: it follows silent mode and Focus like any other notification, and the app and the notification text say that it does not replace the CGM app's alarms. One notification when a reading crosses a threshold, then at most one every 30 minutes while readings stay out of range.

DATA
The app sends the Nightscout address and read-only token, push tokens, and the unit, language and thresholds to our server (Western Europe), which needs them to send the Live Activity updates. The server stores no readings, only the time of the newest one. No ads, no tracking, no third-party analytics. "Remove this phone" in Settings deletes the server's copy at once; an unused copy is deleted after 30 days.

CONTACT
See the contact details in App Review Information. We answer in English or Danish.
```

## Before pasting

- The demo needs the relay running in production (`live-register` and `live-poll` in the poller,
  plan §4) with the production APNs environment. Try "Try the demo" on a TestFlight build first:
  the Live Activity must update with the app closed.
- If the widgets are not in the submitted build yet, nothing here needs to change (the notes do not
  mention them), but the listing does: see `checklist.md`.
- The numbers in step 2 and step 5 come from `poller/src/live/demo.ts` and the app's `DemoCurve`
  (FollowCore), and the default thresholds from `GlucoseThresholds`. Check them again if either
  changes.

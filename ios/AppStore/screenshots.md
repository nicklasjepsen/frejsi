# Screenshots

What to capture for the App Store, in which sizes, and how, all from the demo (made-up readings,
no real person's data).

## Sizes Apple asks for

From Apple's screenshot specifications
(<https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications>),
read on 2026-11-08. Apple changes this page; read it again on the day of upload.

| Display group in App Store Connect      | Portrait pixels                         | Status (2026-11-08)                                | Simulator to use           |
| --------------------------------------- | --------------------------------------- | -------------------------------------------------- | -------------------------- |
| Dynamic Island, large ("6.9 inch")      | 1320 × 2868, 1290 × 2796 or 1260 × 2736 | Optional; when given, the 6.5" set is not needed   | iPhone 17 Pro Max          |
| Face ID, large ("6.5 inch")             | 1284 × 2778 or 1242 × 2688              | Required only if the 6.9" set is missing           | none needed (see below)    |
| Dynamic Island, medium ("6.1/6.3 inch") | 1206 × 2622 or 1179 × 2556              | Required: "at least one screenshot" for this group | iPhone 17 Pro or iPhone 17 |
| Smaller iPhones                         | various                                 | Scaled by Apple from the larger sets               | none                       |

So the plan is **two sets: 6.9" (1320 × 2868) and 6.3" (1206 × 2622)**, each in Danish and English.
The 6.9" set stands in for 6.5", which is why the brief's "6.5 inch" set is not captured: no
current Simulator has a 6.5" Face ID display, and Apple does not require it when 6.9" is there. If
App Store Connect still shows a 6.5" slot as required on the day, capture on an iPhone 11 Pro Max
Simulator runtime (1242 × 2688) or let App Store Connect use the 6.9" set where it offers to.

To verify on the day:

- [ ] Which groups are marked required in App Store Connect's media manager for this app.
- [ ] The **iPhone Duo** group: Apple's page says it becomes required in April 2027 for apps built
      with the iOS 27.1 SDK or later. Builds on the iOS 27.0 SDK are not affected yet.
- [ ] At most 10 screenshots per size; `.png` or `.jpg`; **no alpha channel**. Simulator
      screenshots are normally opaque; if App Store Connect refuses one, convert it with
      `sips -s format jpeg in.png --out out.jpg`.
- [ ] No iPad set: the app is iPhone only (`ios/project.yml`). If App Store Connect asks for iPad
      screenshots, the target's device family is wrong; fix that, do not add iPad images.

## The six screenshots

Every one in demo mode. The captions are short lines to set above the screenshot in a frame (Apple
has no caption field; text is part of the image). Plain screenshots without captions are fine too.
Captions follow the listing's rules: no medical claims, nothing about insulin or treatment, CarPlay
only as "on the CarPlay screen", nothing about driving.

| #   | Screen                             | State                                                                                                                      | Caption (da)                             | Caption (en)                            |
| --- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------- |
| 1   | Main screen                        | Demo, a green value in range with its arrow, change and "3 min siden" / "3 min ago", the 3-hour curve; the demo line shows | Blodsukkeret med pil og alder            | The glucose, with its arrow and age     |
| 2   | Lock screen with the Live Activity | Phone locked, the app closed, the activity showing a green demo value and its age                                          | På låseskærmen, også når appen er lukket | On the lock screen, with the app closed |
| 3   | Dynamic Island, expanded           | Another app or the home screen open, long-press on the island                                                              | Altid ved hånden i Dynamic Island        | Close at hand in the Dynamic Island     |
| 4   | Main screen, 12-hour curve         | Window set to 12 h, so the curve shows green, yellow and the target band                                                   | De seneste 3, 6 eller 12 timer           | The last 3, 6 or 12 hours               |
| 5   | Settings, the colours section      | Unit mmol/L, the four thresholds and the footer text visible                                                               | Farver efter jeres egne grænser          | Colours by your own thresholds          |
| 6   | Onboarding (first screen)          | Freshly installed or after "Remove this phone": "Tryk på linket, du har fået", the QR and demo buttons, the disclaimer     | Tryk på linket, så er du i gang          | Tap the link and you are set            |

An optional seventh, once the relay sends reminders to the Simulator build: a low or high reminder
on the lock screen ("Høj: 11,2 mmol/L · 2 min siden" / "High: 11.2 mmol/L · 2 min ago"), caption
"En påmindelse, ikke en alarm" / "A reminder, not an alarm".

No CarPlay or Apple Watch images: the iPhone sets show the iPhone, and the listing names CarPlay and
the Watch in words only. When the widgets ship (plan stage 5), a home-screen widget can replace
screenshot 4 or be added as number 7.

## Capturing them in the Simulator

On the Mac, with the app built as in `ios/README.md` ("Build the app").

1. Boot each Simulator once and set it to Danish first (then English for the second pass). The app
   and the Live Activity follow the phone's preferred languages, so set the language for the whole
   device, not only for the app:
   ```
   xcrun simctl boot "iPhone 17 Pro Max"
   xcrun simctl spawn booted defaults write -g AppleLanguages -array da en
   xcrun simctl spawn booted defaults write -g AppleLocale da_DK
   xcrun simctl shutdown "iPhone 17 Pro Max" && xcrun simctl boot "iPhone 17 Pro Max"
   ```
   For English: `-array en da` and `en_GB`, then reboot the Simulator.
2. Clean status bar:
   ```
   xcrun simctl status_bar booted override --time 9:41 --dataNetwork 5g \
     --wifiBars 3 --cellularMode active --cellularBars 4 --batteryState charged --batteryLevel 100
   ```
3. Install and open the app (`xcodebuild ... build`, then `xcrun simctl install booted <path to
Naensom.app>` and `xcrun simctl launch booted ninja.jepsen.naensom`), or run it from Xcode.
4. Screenshot 6 first: on the onboarding screen, `xcrun simctl io booted screenshot 6-onboarding.png`.
5. Tap **Prøv demoen** / **Try the demo**. The Live Activity starts by itself. The demo curve is a
   function of the clock (a three-hour wave between about 3.7 and 11.8 mmol/L), so wait until the
   value is green for screenshots 1 to 3. Take screenshot 1 a few minutes after a reading, so the age
   reads "3 min".
6. Screenshot 4: choose 12 hours on the main screen. Screenshot 5: Settings, scrolled so the colours
   section is in view.
7. Screenshot 2: lock the Simulator (Device → Lock, ⌘L), wake it (⌘L again or the side button) and
   capture. While the app was open it updated its own Live Activity with each reading, so the lock
   screen shows the demo value even if the Simulator gets no pushes from the relay (the README's
   "Known in the Simulator" note).
8. Screenshot 3: unlock, go to the home screen, long-press the Dynamic Island, capture.
9. Repeat on "iPhone 17 Pro" for the 6.3" set, then both again in English.

Name the files `<size>-<lang>-<n>-<screen>.png` (for example `6.9-da-1-main.png`) and keep them
outside the repo, or under `ios/AppStore/screenshots/` if the owner wants them versioned: they show
made-up data only. Check each one before upload: no real site address, no token, no debug section
(build Release, or make sure the Settings screenshot does not show "Push tokens (debug builds)").

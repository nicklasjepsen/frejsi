# Submission checklist

The steps from an uploaded build to "Submit for Review", in order, for Nænsom 0.1.0. Plan
`docs/superpowers/plans/2026-11-08-ios-follower-app.md` §6 and §7 (stage 6). **Owner** marks the
steps only the owner can do: they need the Account Holder or Admin role in App Store Connect, a
legal judgement, or his name.

## Before App Store Connect

- [ ] **The relay runs in production**: `live-register` and `live-poll` deployed with the production
      APNs environment, so the demo and the Live Activity work for a TestFlight or App Store build.
- [ ] **The support and privacy pages are live** at `https://naensom.jepsen.ninja/support` and
      `https://naensom.jepsen.ninja/privacy`, in Danish and English. The privacy page matches
      `app-privacy.md`. Apple checks that both URLs open.
- [ ] **The host name works**: `naensom.jepsen.ninja` serves those pages and
      `/.well-known/apple-app-site-association` (`ios/README.md`, "Follow-ups outside `ios/`").
      The host rename is waiting for the owner; until it is done, the two URLs must point somewhere
      that answers. **Owner.**
- [ ] **The real icon** replaces the placeholder (`App/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png`).
      Apple rejects placeholder-looking icons. **Owner** picks it.
- [ ] **The listing matches the build.** Every feature in `listing.da.md` and `listing.en.md` must
      be in the build that is submitted (App Review guideline 2.3). Check in particular:
  - [ ] **Widgets**: plan stage 5, not in the app at the time of writing. If the build has none,
        delete the "Widgets" line from both descriptions and the "widget" keyword.
  - [ ] **Apple Watch Smart Stack and CarPlay**: the Live Activity's small family is declared
        (`LiveActivity/GlucoseLiveActivity.swift`). It appears there from iOS 18 (Watch) and iOS 26
        (CarPlay). Check once in Xcode's CarPlay simulator.
  - [ ] **Low and high reminders**: the relay sends them in production.
- [ ] **TestFlight on the owner's own iPhone** for a few days (plan §7, stage 6), including the push
      test across the 8-hour restart on a real phone. **Owner** (his phone).
- [ ] **Screenshots captured** per `screenshots.md`, both languages, both sizes.
- [ ] **Copy check by hand**: the listing, review notes and screenshot captions contain none of the
      words in `shared/src/dosing-vocabulary.ts` (`insulin`, `dosis`, `dose`, `dosing`, `ratio`,
      `correction`, `korrektion`, `ICR`, `ISF`, `IE`, `IU`, `bolus`). The review notes use "never
      calculates insulin" once, which is the allow-listed phrase; the listings use none of them.
      Re-run after any edit:
      `     grep -inwE 'insulin|dosis|dose|dosing|ratio|correction|korrektion|ICR|ISF|IE|IU|bolus' ios/AppStore/listing.*.md
    `
      (no output is the pass).
- [ ] **Lengths**: name and subtitle at most 30 characters, promotional text 170, description and
      What's New 4000, keywords 100. Apple counts the keyword field in bytes on some screens: the
      Danish keywords are 92 characters, 95 bytes with æ, ø and å. Checked for this version with a
      script over the fenced blocks; re-check after edits.

## In App Store Connect

1. **Create the app record** (Apps → +, New App). **Owner.**
   - Platform iOS; name **Nænsom**; primary language **Danish**; bundle ID `ninja.jepsen.naensom`;
     SKU `naensom-ios`; user access Full Access.
   - If "Nænsom" is taken, App Store Connect says so here; the owner chooses a variant (for example
     "Nænsom – blodsukker"), and the listings change to match.
2. **App Information** (General → App Information).
   - Localisations: Danish (primary) and English (U.K.); add English (U.S.) with the same text if
     wanted. Subtitle per `listing.*.md`.
   - Category: **Medical**, no secondary category.
   - Content Rights ("Does your app contain, show, or access third-party content?"): **No**
     recommended. The app shows only the user's own data, from a Nightscout site the user (or the
     family) runs and chose to connect, like a mail app showing the user's own mail; it ships no
     content of anyone else's. If the owner reads the question more strictly, the answer is "Yes"
     with "I have the necessary rights", since the user grants access with their own token.
     **Owner** confirms.
   - Age Rating: the honest answers come out at **4+**:
     - Every content description (violence, sexual content, profanity, horror, alcohol, gambling,
       contests and the rest): **None**.
     - **Medical or Treatment Information: None.** The app shows readings and colours; it gives no
       diagnosis, guidance, medication or treatment information (Apple's definition: "diagnoses or
       guidance around the management of medical conditions"). "Infrequent" would make it 13+,
       "frequent" 16+.
     - **Health or Wellness Topics: No** (no self-care or lifestyle recommendations).
     - Unrestricted web access: **No** (the privacy and support links open those two pages only).
     - User-generated content, messaging, advertising, social media: **No**.
     - Parental controls and age assurance: **No**.
   - **Regulated medical device** (App Store Regulations & Permits → Declare Regulated Medical
     Device): required for apps in the Medical category in the EEA, UK and US. The expected answer is
     **No**: Nænsom is not cleared, registered or certified as a medical device anywhere. Whether it
     _should_ be (a secondary display of CGM data with low and high notifications, used by families
     in the EU) is a legal question, not a form field. **Owner** decides, and takes advice if in
     doubt; the copy already says it is not a medical device and does not replace the CGM app's
     alarms.
   - **Export compliance**: already answered by the build (`ITSAppUsesNonExemptEncryption` false,
     HTTPS only through Apple's APIs); App Store Connect does not ask again.
3. **Pricing and Availability**: price **Free** (tier 0). Availability: all countries, or Denmark
   first if the owner prefers. **Owner** chooses. Pre-orders off.
4. **App Privacy**: enter the answers in `app-privacy.md`, then the privacy policy URL. The
   "linked to the user" answer is the owner's call; the file recommends Yes. **Owner.**
5. **The version (0.1.0)**, per localisation: promotional text, description, keywords, support URL,
   marketing URL (empty), screenshots from `screenshots.md`. What's New is not shown for a first
   version. Copyright: "2026" and the account holder's name. **Owner** for the name.
6. **Build**: choose the build uploaded with `fastlane beta` or `scripts/upload-testflight.sh`
   (version 0.1.0, the newest build number that passed TestFlight). It must have finished
   processing.
7. **App Review Information**: sign-in required **off**; contact name, phone and email (**owner**);
   notes from `review-notes.md`. No attachment needed.
8. **Version release**: "Manually release this version" is the safer first choice, so the owner
   chooses the moment. **Owner.**
9. **Add for Review**, then **Submit to App Review**. **Owner** (or whoever holds the Admin role).

## After submitting

- Apple usually answers within one to a few days; a Medical app may get questions (plan §6). Answer
  in App Store Connect's Resolution Center. Typical questions and where the answers are:
  - "How do we test without an account?": the demo, step by step in `review-notes.md`.
  - "Is this a medical device / is it cleared?": no; it shows the user's own data and makes no
    treatment decisions (`review-notes.md`, "Health disclaimer").
  - "Why frequent Live Activity updates / time-sensitive notifications?": `review-notes.md`.
- When approved: tag the approved version as `ios-vX.Y.Z` (plan, "Tags").
- On a rejection: fix, upload a new build (next build number), update `review-notes.md` and the
  listing in this folder in the same PR as the fix, and resubmit.

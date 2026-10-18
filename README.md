# Frejsi

**Carb counting and live glucose, for a person with diabetes and the people around them.**

Frejsi is a web app — on your phone for the moment you're eating, on your desktop for the evening you want to understand the week — that answers two questions fast: _how many carbs is this?_ and _what did that meal do to my glucose?_ A space brings one person's food library, meals and glucose together, with access for the people they invite.

> **Status: v0.7.0 is live at [frejsi.jepsen.ninja](https://frejsi.jepsen.ninja).**

v0.5.2 is the phone round: no zoom on text entry, a fixed tab bar, barcode scanning that names its failure, 48px back controls, a light/dark theme setting and the visual phone audit fixes. v0.5.3 makes the scanner read a barcode twice before it believes it; v0.5.5 adds the "Spiser om" chips on the confirm step and an immutable secret reference from source-connect (the v0.5.4 tag failed its suite and deployed nothing: a meal stamped ahead of now was missing from the day). The v0.5.1 tag failed in its suite on a README line and deployed nothing.

v0.7.0 reads the pump's own record from a Nightscout site: the boluses the pump recorded, with their time and delivered units, on the curve and on the meal they belong to, for owners and carers outside simple mode. v0.7.1, on `main` and not yet released, keeps the boluses Nightscout sends with no carbs (every automatic bolus), which v0.7.0 dropped.

The v0.1.0 foundation (passkeys, roles and live glucose), v0.2.0 food lookup and meal logging, v0.3.0 meal curves and history, the v0.3.1 Dexcom Clarity import and the v0.4.1 AI features are implemented and deployed. The AI features remain off until a provider is configured and a space opts in. v0.5.0 (Nightscout and manual glucose sources, Open Food Facts corrections, the poller's managed identity and the country settings) and v0.6.1 (logging how you feel, dishes from recipes, food categories and the symbol on the curve, and editing a meal from its row) are deployed. v0.6.2, also deployed, lets a symptom be logged at an earlier time, up to a week back, gives every phone screen the same 20 px under the space name, and removes the "Bolus givet nu" tap; bolus items show only for meals that already have a bolus time. Merging does not deploy: a version tag runs the release pipeline, and a [GitHub release](https://github.com/nicklasjepsen/frejsi/releases) is published only after deployment and smoke checks succeed. An existing tag alone does not mean deployment succeeded. Frejsi is free software (AGPL-3.0) and built to be run by anyone: your country, your language and your glucose source are settings, not code.

## What it does

- **Look up carbs** — search your space's library, the shared cache, Open Food Facts and the bundled DTU Frida dataset. Scan a barcode with the phone camera or type one on desktop. Save your own foods and dishes with private photos and named portions. Imported and manually entered foods start unverified; owners and carers can verify the space's copy individually or in a batch. When the deployment has an Open Food Facts account configured, an owner or carer editing an Open Food Facts food can tick "Send rettelsen til Open Food Facts" before saving to send the corrected carbohydrates per 100 g and serving size back; the box is unticked on every open, nothing is sent otherwise, and the space's copy stays unverified until someone ticks it. Make a dish from a recipe: a photo, a web page, pasted text, or a page shared to Frejsi from another app on the phone. Frejsi reads the ingredient lines and the yield, matches each line to a food, shows the carbs per line and the total, and saves the dish with carbs per 100 g and named portions ("1 portion", "½ portion") from the yield, unverified until someone ticks it; change a line or the yield later and the dish is recalculated. Every food has a category (bread, fruit, vegetables, dairy, starch, protein, sweets, snack, drink or mixed), from Frida, Open Food Facts or the enrichment pass, set by hand with one row of chips, and shown as a small symbol in the library.
- **Log meals** — pick foods and portions, review the carb total, and save a meal with a time, note or photo. Edit or delete it later from the meal, or straight from its row on Now and in the day ("Ret" opens the meal with the edit sheet), or save it as a dish or as a recipe. Each meal gets a symbol for what was eaten (the dominant food's category, a plate for a mixed meal) when it is saved, drawn on its marker on the curve. Meals keep snapshots of their foods and their symbol, so changing the library does not rewrite past meals.
- **Log how you feel** — "Jeg har det…": one tap on a picture logs a stomach ache, dizziness, nausea, tiredness, a headache or shakiness at now, or 15 minutes to two hours ago with the "Hvornår?" chips above the pictures, with ten seconds to take it back; severity, a note and any day and time in the last week are a second, optional step. Symptoms sit on the curve and in history next to the meals, in their own shape and colour, and the people who can read meals can read them. A child in simple mode logs with one tap and the adults get a notification. The AI observations may mention a symptom next to a meal, never explain it.
- **Simple mode** — a large, picture-first picker with verified foods only, plus a simpler Now screen and meal detail. It is a per-person setting, independent of their role.
- **Live glucose and meals together** — readings from Dexcom Share or your own Nightscout site fetched every five minutes, or finger-prick values you type in, pushed to the app with a polling fallback. Now shows the reading with its age, the curve and meal markers. A meal detail shows its following three hours, peak and time in range, and previous occurrences of the same dish for comparison. Where a meal has a bolus time (from the pump record below, or tapped before v0.6.2; the app never asks for one), the curve marks it and the meal, compare and week views show its minutes before the meal; without one they leave the bolus out.
- **The pump's own record (v0.7.0)** — pump history, read from a Nightscout site that the pump's uploads reach (for a Tandem pump, through tconnectsync). An owner connects it under Indstillinger → Pumpehistorik with the site's address and a read-only token; it is its own connection, beside the glucose source. Every 15 minutes Frejsi reads the boluses the pump recorded over the last day: the time, the delivered units, the kind (standard, extended or Control-IQ's automatic ones) and the carbs typed into the pump. Basal, temp basal and every other record are never read. Each bolus is drawn on the day and meal curves with its time and units ("Bolus 11:58 · 2,4 E"), automatic ones as a smaller hollow marker. A standard or extended bolus from 45 minutes before to 30 minutes after a meal becomes that meal's bolus time, so its minutes before the meal show without a tap, and the meal shows the pump's carbs next to the logged total ("Pumpen: 45 g"). When nobody logs a meal for a bolus with carbs within two hours, Frejsi adds an unverified pump meal ("Fra pumpen · ikke tjekket") that an owner or carer ticks or corrects. Tandem uploads the pump's history about hourly, so a bolus can arrive up to an hour late; the curve says how far the record reaches ("Pumpe til 11:58"). Owners and carers see it outside simple mode; a viewer, a simple-mode screen and an AI model never get any of it. Frejsi only reads: it never writes to the pump or the site, and it shows what the pump delivered, never a dose to give.
- **Day and week history** — browse daily curves and meals, a week of daily curves and summary statistics, or the week's meals table. Viewers get meal-only days and carb totals; the server never sends them glucose.
- **Import glucose history** — an owner loads a Dexcom Clarity CSV export into the space: its readings fill History and the meal curves, and its carb entries can become meals to correct later. Importing the same file twice adds nothing; rows of any other kind in the file are counted and never kept.
- **People and settings** — passkey sign-in, single-use invitations by link or QR code, extra devices and owner/carer/viewer roles. Danish and English, light and dark (following the device or chosen per person), mmol/L or mg/dL, target range and a personal accent. Responsive phone and desktop layouts, with an installable PWA shell.
- **AI help (v0.4.0)** — semantic food search, typed/voice meal logging, approximate photo estimates with adult verification, meal observations and editable weekly clinic questions. Raw readings never reach a model. AI stays off until a provider is configured.

On a phone, log a meal from the food picker, say when eating starts (now, or 5 to 20 minutes from now, with 15 preselected) or set an exact time, and tap its marker on Now to open the meal curve. On a desktop, review the week, compare earlier meals and manage the food library and people. Meal attachments are uploaded when you save. In the v0.4.0 implementation, spaces with AI enabled and a configured provider can explicitly capture a plate photo from the picker or `/ask` for an approximate estimate. “Ask an adult” saves it as an unverified library food and stores the photo; it never logs a meal. AI stays off until a provider is configured and the space opts in; browser notifications are opt-in per device.

What is still to come is on the [roadmap](#roadmap). People who are not on Azure can run the app with Docker Compose: see [docs/deploy-your-own.md](docs/deploy-your-own.md#docker-compose-any-host-with-docker).

## What it will never do

**Frejsi never computes, suggests or lets anyone enter insulin.** No input field, no calculation, no ratio, no correction, no "you should". You look up carbs here and enter them in your pump or pen. The one exception is pump history: the time and delivered units of a bolus your pump recorded, imported read-only, shown to owners and carers (never to a viewer, never to an AI model). Showing what the pump delivered is allowed; setting or advising a dose is not. This is a deliberate clinical and legal boundary, enforced in code.

## Deploy your own

Frejsi runs on your own Azure subscription, deployed from your own fork by GitHub Actions: about fifteen minutes of your own steps and roughly 100 DKK a month. [docs/deploy-your-own.md](docs/deploy-your-own.md) walks it from nothing to a running site, with the costs, the honest timings and the order that matters (the custom domain before the first space). [infra/README.md](infra/README.md) is the reference for what gets created and how secrets work, and the [operations runbook](docs/operations.md) covers the first space, source credentials, alerts and rollback.

## Getting started

For the owner of an installation, once the site is deployed. Your own address replaces the placeholders below.

1. **Create your space, once.** Read the one-time `bootstrap-token` from the installation's Key Vault (you need Key Vault Secrets User on it) and send one request with your space name, your name and an IANA time zone. The commands, for PowerShell and for bash, and what each answer means, are in the [operations runbook](docs/operations.md#bootstrap-the-first-space). The answer holds `inviteUrl`. A `404` means a space exists already.
2. **Open `inviteUrl` on your phone** and create a passkey. The link works once and expires after seven days. Add the site to your home screen to install it as an app.
3. **Try it out:**
   - **Bibliotek:** search foods, scan a barcode, save your own foods and tick them verified.
   - **Log a meal:** pick foods and portions, check the carb total, add a photo.
   - **Jeg har det…:** one tap logs how you feel; the entry shows on the curve next to the meals.
   - **I dag and Historik:** today's meals, the day and week views, and a meal's curve.
   - **Personer:** invite people by link or QR code as carer or viewer; a viewer never sees glucose.
   - **Indstillinger:** simple mode (verified foods only), units, target range, language, colour and light or dark.
   - Open the same address on a laptop for the desktop layout.
4. **Connect glucose:** Indstillinger → Glukosekilde → Dexcom Share (the Dexcom login of the person who shares, region EU or US), your own Nightscout site, or Manuelt to type finger-prick values in on Nu. Until a source is connected the screens say so, the curve stays empty, and the "no reading for 35 minutes" alert e-mails the alert address.
5. **Connect the pump record (optional):** if the pump's history reaches a Nightscout site, Indstillinger → Pumpehistorik → Forbind with the site's address and a read-only token; see the [operations runbook](docs/operations.md#pump-record-from-nightscout-v070).
6. **Bring the history along:** export a CSV from Dexcom Clarity and load it under Indstillinger → Data og eksport → Importér fra Dexcom Clarity. Weeks of readings appear in Historik and on the meal curves at once; see the [operations runbook](docs/operations.md#import-a-dexcom-clarity-export).

## Stack

pnpm monorepo: `web/` — Next.js App Router and API routes on Azure Static Web Apps; `poller/` — Node 22 Azure Functions; `shared/` — TypeScript, Zod contracts, Prisma and domain logic; `infra/` — Bicep and deployment scripts. Azure SQL Basic stores data, Web PubSub carries live events, Key Vault holds secrets, and private Blob Storage holds photos. Glucose sources, food sources and AI providers are plugins behind interfaces: [docs/architecture.md](docs/architecture.md) is the map. `docker/` runs the same code on any host with Docker Compose, with SQL Server, Azurite and file secrets in place of the Azure services.

## Roadmap

The roadmap is a set of plans and the issues that come out of them, not a list in this file.

- [The roadmap](docs/superpowers/plans/2026-10-14-roadmap.md) says what each version is for, and the versioned plans next to it ([v0.7.0, the pump's own record](docs/superpowers/plans/2026-10-18-v0.7.0-pump-record.md) is the current one) say how it is built.
- The [open issues](https://github.com/nicklasjepsen/frejsi/issues) are the work, grouped by [milestone](https://github.com/nicklasjepsen/frejsi/milestones); a milestone is a release.
- The [original spec](docs/superpowers/specs/2026-10-14-frejsi-design.md) and the [design exports](docs/design/README.md) record the intent; the code and the runbooks describe what is implemented.

## Contributing

Start with [CONTRIBUTING.md](CONTRIBUTING.md). The most useful contributions are food sources for your country ([docs/plugins/food-source.md](docs/plugins/food-source.md)) and glucose sources ([docs/plugins/glucose-source.md](docs/plugins/glucose-source.md)). [CLAUDE.md](CLAUDE.md) has the working rules and [the agent workflow](docs/agent-workflow.md) describes CI and releases.

## Licence

[AGPL-3.0](LICENSE). Contributions welcome under the [DCO](CONTRIBUTING.md#developer-certificate-of-origin).

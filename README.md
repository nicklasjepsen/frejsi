# Frejsi

**Carb counting and live glucose, for a person with diabetes and the people around them.**

Frejsi is a web app — on your phone for the moment you're eating, on your desktop for the evening you want to understand the week — that answers two questions fast: _how many carbs is this?_ and _what did that meal do to my glucose?_ A space brings one person's food library, meals and glucose together, with access for the people they invite.

> **Status: v0.4.0 is implemented; v0.3.1 is live at [frejsi.jepsen.ninja](https://frejsi.jepsen.ninja).** The v0.1.0 foundation (passkeys, roles and live glucose), v0.2.0 food lookup and meal logging, v0.3.0 meal curves and history, and the v0.3.1 Dexcom Clarity import are implemented and deployed. The v0.4.0 AI features remain off until a provider is configured and a space opts in. Merging does not deploy: a version tag runs the release pipeline, and a [GitHub release](https://github.com/nicklasjepsen/frejsi/releases) is published only after deployment and smoke checks succeed. An existing tag alone does not mean deployment succeeded.

## What it does

- **Look up carbs** — search your space's library, the shared cache, Open Food Facts and the bundled DTU Frida dataset. Scan a barcode with the phone camera or type one on desktop. Save your own foods and dishes with private photos and named portions. Imported and manually entered foods start unverified; owners and carers can verify the space's copy individually or in a batch. When the deployment has an Open Food Facts account configured, an owner or carer editing an Open Food Facts food can tick "Send rettelsen til Open Food Facts" before saving to send the corrected carbohydrates per 100 g and serving size back; the box is unticked on every open, nothing is sent otherwise, and the space's copy stays unverified until someone ticks it.
- **Log meals** — pick foods and portions, review the carb total, and save a meal with a time, note or photo. Edit or delete it later, or save it as a dish. Meals keep snapshots of their foods, so changing the library does not rewrite past meals.
- **Simple mode** — a large, picture-first picker with verified foods only, plus a simpler Now screen and meal detail. It is a per-person setting, independent of their role.
- **Live glucose and meals together** — Dexcom Share readings fetched every five minutes, pushed to the app with a polling fallback. Now shows the reading with its age, the curve and meal markers. A meal detail shows its following three hours, peak and time in range, and previous occurrences of the same dish for comparison.
- **Day and week history** — browse daily curves and meals, a week of daily curves and summary statistics, or the week's meals table. Viewers get meal-only days and carb totals; the server never sends them glucose.
- **Import glucose history** — an owner loads a Dexcom Clarity CSV export into the space: its readings fill History and the meal curves, and its carb entries can become meals to correct later. Importing the same file twice adds nothing; rows of any other kind in the file are counted and never kept.
- **People and settings** — passkey sign-in, single-use invitations by link or QR code, extra devices and owner/carer/viewer roles. Danish and English, light and dark themes, mmol/L or mg/dL, target range and a personal accent. Responsive phone and desktop layouts, with an installable PWA shell.
- **AI help (v0.4.0, implemented, awaiting release)** — semantic food search, typed/voice meal logging, approximate photo estimates with adult verification, meal observations and editable weekly clinic questions. Raw readings never reach a model. AI stays off until a provider is configured; #72 tracks the production setup.

On a phone, log a meal from the food picker and tap its marker on Now to open the meal curve. On a desktop, review the week, compare earlier meals and manage the food library and people. Meal attachments are uploaded when you save. In the v0.4.0 implementation, spaces with AI enabled and a configured provider can explicitly capture a plate photo from the picker or `/ask` for an approximate estimate. “Ask an adult” saves it as an unverified library food and stores the photo; it never logs a meal. AI stays off until a provider is configured and the space opts in; browser notifications are opt-in per device.

Nightscout, manual glucose entry and community/portability features are also future work; see the [issues](https://github.com/nicklasjepsen/frejsi/issues) and [roadmap](docs/superpowers/plans/2026-10-14-roadmap.md).

## What it will never do

**Frejsi does not calculate, suggest or display insulin doses.** You look up carbs here and enter them in your pump or pen. This is a deliberate clinical and legal boundary, enforced in code.

## Getting started

For the owner of an installation, once the site is deployed. This one is
[frejsi.jepsen.ninja](https://frejsi.jepsen.ninja); a fork uses its own address.

1. **Create your space, once.** Read the one-time `bootstrap-token` from the installation's Key
   Vault (you need Key Vault Secrets User on it, `infra/README.md` step 8) and send one request with
   your space name, your name and an IANA timezone. With the Azure CLI signed in and the
   installation's subscription selected (`az account set --subscription <id>`), in PowerShell 7:

   ```powershell
   $vault = az keyvault list -g frejsi --query "[0].name" -o tsv; $t = az keyvault secret show --vault-name $vault -n bootstrap-token --query value -o tsv; Invoke-RestMethod -Method Post -Uri https://frejsi.jepsen.ninja/api/bootstrap -Headers @{ "x-bootstrap-token" = $t } -ContentType "application/json" -Body '{"spaceName":"<space name>","ownerName":"<your name>","timezone":"Europe/Copenhagen"}'; Remove-Variable t
   ```

   The bash version, and what each answer means, is in the
   [operations runbook](docs/operations.md#bootstrap-the-first-space). The answer holds `inviteUrl`.
   A `404` means a space exists already.

2. **Open `inviteUrl` on your phone** and create a passkey. The link works once and expires after
   seven days. Add the site to your home screen to install it as an app.
3. **Try it out:**
   - **Bibliotek:** search Danish foods, scan a barcode, save your own foods and tick them verified.
   - **Log a meal:** pick foods and portions, check the carb total, add a photo, tap the time you
     gave the bolus.
   - **I dag and Historik:** today's meals, the day and week views, and a meal's curve.
   - **Personer:** invite people by link or QR code as carer or viewer; a viewer never sees glucose.
   - **Indstillinger:** simple mode (verified foods only), units, target range, language and colour.
   - Open the same address on a laptop for the desktop layout.
4. **Connect live glucose:** Indstillinger → Glukosekilde → Dexcom Share, with the Dexcom login of
   the person who shares (region EU or US). Until then the screens say the source is not connected,
   the curve stays empty, and the "no reading for 35 minutes" alert e-mails the alert address.
5. **Bring the history along:** export a CSV from Dexcom Clarity and load it under Indstillinger →
   Data og eksport → Importér fra Dexcom Clarity. Weeks of readings appear in Historik and on the
   meal curves at once; see the [operations runbook](docs/operations.md#import-a-dexcom-clarity-export).

## Stack

pnpm monorepo: `web/` — Next.js App Router and API routes on Azure Static Web Apps; `poller/` — Node 22 Azure Functions; `shared/` — TypeScript, Zod contracts, Prisma and domain logic; `infra/` — Bicep and deployment scripts. Azure SQL Basic stores data, Web PubSub carries live events, Key Vault holds secrets, and private Blob Storage holds photos. Docker Compose deployment is future work.

## Development and docs

Start with [CONTRIBUTING.md](CONTRIBUTING.md). [CLAUDE.md](CLAUDE.md) has the working rules and [the agent workflow](docs/agent-workflow.md) describes CI and releases. The [operations runbook](docs/operations.md) covers bootstrap, source credentials, alerts, rollback and local release suites. [Design exports](docs/design/README.md) and the [original spec](docs/superpowers/specs/2026-10-14-frejsi-design.md) record design intent; the code and current runbooks describe what is implemented.

## Licence

[AGPL-3.0](LICENSE). Contributions welcome under the [DCO](CONTRIBUTING.md).

## Deploy your own

Follow the [fork and Azure setup walkthrough](infra/README.md#deploy-your-own-in-15-minutes). It requires Azure resources, OIDC permissions, GitHub environments, repository variables and secrets. The [infrastructure guide](infra/README.md) lists resources and cost estimates. Deploy through the tag-driven `release.yml` workflow, then use the [operations runbook](docs/operations.md#bootstrap-the-first-space) to create the first space and connect Dexcom Share.

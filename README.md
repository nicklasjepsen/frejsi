# Frejsi

**Carb counting and live glucose, for a person with diabetes and the people around them.**

Frejsi is a web app — on your phone for the moment you're eating, on your desktop for the evening you want to understand the week — that answers two questions fast: _how many carbs is this?_ and _what did that meal do to my glucose?_ A space brings one person's food library, meals and glucose together, with access for the people they invite.

> **Status: v0.3.0 implementation on `main`.** The v0.1.0 foundation (passkeys, roles and live glucose), v0.2.0 food lookup and meal logging, and v0.3.0 meal curves and history are implemented. Azure resources exist. Merging does not deploy: a version tag runs the release pipeline, and a [GitHub release](https://github.com/nicklasjepsen/frejsi/releases) is published only after deployment and smoke checks succeed. An existing tag alone does not mean deployment succeeded.

## What it does

- **Look up carbs** — search your space's library, the shared cache, Open Food Facts and the bundled DTU Frida dataset. Scan a barcode with the phone camera or type one on desktop. Save your own foods and dishes with private photos and named portions. Imported and manually entered foods start unverified; owners and carers can verify the space's copy individually or in a batch.
- **Log meals** — pick foods and portions, review the carb total, and save a meal with a time, note or photo. Edit or delete it later, or save it as a dish. Meals keep snapshots of their foods, so changing the library does not rewrite past meals.
- **Simple mode** — a large, picture-first picker with verified foods only, plus a simpler Now screen and meal detail. It is a per-person setting, independent of their role.
- **Live glucose and meals together** — Dexcom Share readings fetched every five minutes, pushed to the app with a polling fallback. Now shows the reading with its age, the curve and meal markers. A meal detail shows its following three hours, peak and time in range, and previous occurrences of the same dish for comparison.
- **Day and week history** — browse daily curves and meals, a week of daily curves and summary statistics, or the week's meals table. Viewers get meal-only days and carb totals; the server never sends them glucose.
- **People and settings** — passkey sign-in, single-use invitations by link or QR code, extra devices and owner/carer/viewer roles. Danish and English, light and dark themes, mmol/L or mg/dL, target range and a personal accent. Responsive phone and desktop layouts, with an installable PWA shell.

On a phone, log a meal from the food picker and tap its marker on Now to open the meal curve. On a desktop, review the week, compare earlier meals and manage the food library and people. Photos are uploaded when you save; the app does not estimate their contents.

AI search, voice logging, photo estimates and narrated insights are planned for v0.4.0. Nightscout, manual glucose entry and community/portability features are also future work; see the [issues](https://github.com/nicklasjepsen/frejsi/issues) and [roadmap](docs/superpowers/plans/2026-10-14-roadmap.md).

## What it will never do

**Frejsi does not calculate, suggest or display insulin doses.** You look up carbs here and enter them in your pump or pen. This is a deliberate clinical and legal boundary, enforced in code.

## Stack

pnpm monorepo: `web/` — Next.js App Router and API routes on Azure Static Web Apps; `poller/` — Node 22 Azure Functions; `shared/` — TypeScript, Zod contracts, Prisma and domain logic; `infra/` — Bicep and deployment scripts. Azure SQL Basic stores data, Web PubSub carries live events, Key Vault holds secrets, and private Blob Storage holds photos. Docker Compose deployment is future work.

## Development and docs

Start with [CONTRIBUTING.md](CONTRIBUTING.md). [CLAUDE.md](CLAUDE.md) has the working rules and [the agent workflow](docs/agent-workflow.md) describes CI and releases. The [operations runbook](docs/operations.md) covers bootstrap, source credentials, alerts, rollback and local release suites. [Design exports](docs/design/README.md) and the [original spec](docs/superpowers/specs/2026-10-14-frejsi-design.md) record design intent; the code and current runbooks describe what is implemented.

## Licence

[AGPL-3.0](LICENSE). Contributions welcome under the [DCO](CONTRIBUTING.md).

## Deploy your own

Follow the [fork and Azure setup walkthrough](infra/README.md#deploy-your-own-in-15-minutes). It requires Azure resources, OIDC permissions, GitHub environments, repository variables and secrets. The [infrastructure guide](infra/README.md) lists resources and cost estimates. Deploy through the tag-driven `release.yml` workflow, then use the [operations runbook](docs/operations.md#bootstrap-the-first-space) to create the first space and connect Dexcom Share.

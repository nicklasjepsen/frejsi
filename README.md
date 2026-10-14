# Frejsi

**Carb counting and live glucose, for a person with diabetes and the people around them.**

Frejsi is a web app — on your phone for the moment you're eating, on your desktop for the evening you want to understand the week — that answers two questions fast: *how many carbs is this?* and *what did that meal do to my glucose?* It was started for a nine-year-old with type 1 diabetes and her two households — but it is built for anyone with diabetes, with or without carers.

> **Status: design phase.** No code yet. The design spec lives in [`docs/superpowers/specs/2026-10-14-frejsi-design.md`](docs/superpowers/specs/2026-10-14-frejsi-design.md); the UI brief in [`docs/ui-brief.md`](docs/ui-brief.md).

## What it will do

- **Look up carbs** — barcodes (Open Food Facts), generic foods (DTU Frida), and your own dishes with photos and portions like "1 slice", not "45 g".
- **Simple mode** — a large, picture-first interface so a child (or anyone who wants it simple) can find their lunchbox in two taps and only ever sees numbers an adult has verified.
- **Meals on the live curve** — real-time glucose from Dexcom Share (Nightscout and manual entry planned), each meal drawn on the curve with the following hours, so you learn what pizza actually does.
- **People and roles** — owners, carers and viewers around one person; invite with a QR code; sign in with passkeys (no emails, no passwords, works for kids and grandparents).
- **AI where it helps** — search that understands food, voice logging, photo estimates (always marked "approx." and unverified), and plain-language observations about patterns. Bring your own provider: Anthropic, Azure OpenAI or local Ollama.

## What it will never do

**Frejsi does not calculate, suggest or display insulin doses.** You look up carbs here and enter them in your pump or pen. This is a deliberate clinical and legal boundary, enforced in code.

## Stack

Next.js on Azure Static Web Apps · Azure Functions poller · Azure SQL · Azure Web PubSub · Bicep. Deploy your own with one GitHub Action (Docker Compose planned).

## Licence

[AGPL-3.0](LICENSE). Contributions welcome under the [DCO](CONTRIBUTING.md).

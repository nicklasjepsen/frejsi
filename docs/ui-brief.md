# Frejsi — UI brief (for Claude Design)

Design the UI first, then hand the result to Claude Code for implementation. Read `docs/superpowers/specs/2026-10-14-frejsi-design.md` for the full model; this file is the designer's cut.

## What it is

A web app for one person with diabetes and the people around them. Two jobs, fast: **"how many carbs is this?"** and **"what did that meal do to my glucose?"**

**Design for mobile and desktop as equals.** They do different jobs:

| Device | Job | Design consequence |
|---|---|---|
| **Phone** (360–430 px, installable PWA) | In the moment: look up, scan, log, check the number, "ask an adult". | One-handed, bottom navigation, camera, big targets, everything within two taps. |
| **Desktop** (≥ 1280 px) | Reflection and admin: the week's curves side by side, cleaning up the library, verifying a batch of foods, preparing clinic questions, managing people and devices, connecting sources. | Multi-column layouts, persistent sidebar, keyboard shortcuts, dense tables where useful, curves wide enough to compare. A typed-barcode / USB-scanner field replaces the camera. |
| **Tablet** | Either, depending on orientation. | Inherits whichever layout fits; no third design. |

Deliver both layouts for every screen below. A desktop layout is not the phone layout centred in a wide window.

## Who uses it

| Persona | Mode | Needs |
|---|---|---|
| **The subject, child (9)** | `simpleMode` | Pictures, not words. Big targets. Pick "my lunchbox" in two taps. See her own number with an arrow. Press "ask an adult" when unsure. Never sees unverified numbers. |
| **The subject, adult** | normal | Everything a carer can do, on their own data. |
| **Carer** (parent, partner, grandparent) | normal | Scan a barcode in the shop. Log a meal by voice. Verify foods with one tick. Open a meal and see the next 3 hours of glucose under it. Get a push when the child asks for help. |
| **Owner** (parent/admin) | normal | Invite people with a QR code, manage devices, connect the glucose source, turn AI on/off. |
| **Viewer** (teacher, after-school club) | read-only | Today's meals and carb totals. **No glucose, ever.** |

## Modes

- **`simpleMode`** is a per-person setting, not a role. It changes the whole shell: fewer screens, larger type, photos first, verified-only content, "ask an adult" instead of edit.
- Light and dark, system-driven.
- Languages: Danish first, English from day one. Numbers in mmol/L by default, mg/dL selectable per space.

## Screens (v1)

1. **Now** — current glucose with trend arrow and age ("6.2 ↗ · 3 min ago"); last meal; a short sparkline of the last 3 hours. In `simpleMode`: the number, the arrow, and one big button "I'm eating".
2. **Log a meal** — three entry points of equal weight: **scan** (barcode), **say it** (voice/text), **pick** (own library with photos, favourites, "my lunchbox"). Then: portions as chips ("1 slice", "½ slice", "weigh it"), running carb total, confirm. Optional photo. No bolus tap: the bolus time comes from an imported pump record, later.
3. **Meal detail** — the meal on top, the glucose curve for −1 h to +4 h below with the meal marked, and the bolus time when an imported pump record holds one; the same dish's previous curves faintly behind. AI insight as one sentence, clearly labelled as observation.
4. **Library** — the space's foods with photos; search (semantic); unverified items marked; tick to verify. Edit portions. "Send correction to Open Food Facts".
5. **History** — days as a scrollable timeline of meals over the glucose curve; weekly summary with the generated "questions for the clinic".
6. **People** — members and roles; invite (QR + link); devices per person; remove.
7. **Settings** — glucose source (connect Dexcom Share / Nightscout / manual; status), AI (on/off, provider), units, language, `simpleMode` per person.
8. **Invite landing** — "Hi Susanne, you've been invited to Freja's space" → register a passkey.

## Hard constraints the design must respect

- A glucose value is never shown without its age.
- Viewers never see glucose anywhere — not in history, not in meal detail.
- AI estimates are always labelled "approx." and visibly unverified.
- No insulin input, calculation or suggestion anywhere in the UI. The one exception is pump history (v0.7.0, #216): the time and delivered units of a bolus the pump recorded, shown to owners and carers outside simpleMode, never to a viewer. Showing what the pump delivered is allowed; setting or advising a dose is not.
- On the phone everything must work one-handed; the child's flow must work in a school corridor in under 20 seconds.
- On desktop everything must be reachable by keyboard; the "verify a batch of foods" and "compare this dish's last five curves" flows are desktop-first and must not feel like a phone screen.
- `simpleMode` exists on both devices and is the same shell — large, picture-first — not a different app.
- Must look like a calm health tool, not a fitness app — no streaks, no confetti, no red for a high reading (highs and lows are information, not failure).

## Tone

Warm, plain, unhurried. Danish copy should sound like a kind nurse, not a startup.

# Frejsi — UI design hand-in

This folder is the output of the UI design pass in Claude Design, done from `docs/ui-brief.md` on 2026-10-14, before any code existed. It is the visual reference for every implementation plan under `docs/superpowers/plans/`.

- `artboards/` — the 30 artboards exactly as exported (`*.dc.html`) plus `canvas.json`, the index with titles and the two pages. They are static HTML with inline styles; open one in a browser to see the screen. Treat them as reference data, not as code to ship: the production UI is built from the tokens and components below, not by copying the markup.
- `tokens.json` — colours (light and dark), the per-person accent colours, fonts, the type scale, radii, spacing, navigation sizes, touch targets and chart conventions, all read from the artboards.
- This file — what was chosen, which screens exist, how navigation works, the component list, the Danish vocabulary, and what the spec needs that the artboards do not show.

Names in the artboards (Alma, Jonas, Mette, Birthe, Søren, Lærke) are fictional fixtures; they are not real people and may be reused in seed data.

## The chosen direction: A "Kitchen table"

Three directions were sketched on the page *Retninger*; A was chosen and built out on the page *Skærme*. B "Quiet clinic" (`B-QuietClinic.dc.html`, IBM Plex Sans, blue-grey) and C "Picture book" (`C-PictureBook.dc.html`, Outfit, yellow accents) are kept as rejected sketches only; nothing in them is a token.

"Kitchen table" means: warm paper ground (`#F6F1E8`), cream cards (`#FFFCF6`) with a one-pixel hairline shadow instead of elevation, a serif for names and headings (Newsreader) and a high-legibility sans for everything else (Atkinson Hyperlegible), an olive accent by default, and terracotta reserved for meals. The glucose number is always the text colour and never coloured by its value; highs and lows are information, not alarms. No streaks, no confetti, no red.

## Screen inventory

Spec screen (`docs/ui-brief.md` §Screens) → artboards. "simpleMode" is the per-person large picture-first shell; "viewer" is the read-only role.

| # | Spec screen | Phone | Desktop | simpleMode | Other |
|---|---|---|---|---|---|
| 1 | Now (Nu) | `Main.dc.html` — Nu · telefon | `Nu-Desktop.dc.html` — Nu · desktop | `Nu-Simpel.dc.html` — Nu · simpleMode; `Nu-Simpel-Desktop.dc.html` — Nu · simpleMode desktop | Dark: `Nu-Moerk.dc.html` — Nu · mørk. Accents: `Farve-Nu-Blomme.dc.html` — Nu · Blomme (Alma); `Farve-Nu-Hav.dc.html` — Nu · Hav; `Farve-Nu-Skov.dc.html` — Nu · Skov; `Farve-Nu-Granat.dc.html` — Nu · Granat |
| 2 | Log a meal (Log et måltid) | `Log-Telefon.dc.html` — Log et måltid · telefon (entry points, favourites, recent); `Log-Portioner.dc.html` — Log · portioner og bekræft | `Log-Desktop.dc.html` — Log et måltid · desktop (search/scan field, results, meal being built) | `Log-Simpel.dc.html` — Log · simpleMode ("Hvad spiser du?" picker) | — |
| 3 | Meal detail (Måltid) | `Maaltid-Telefon.dc.html` — Måltid · telefon (−1 h/+4 h curve, stats, AI observation, items) | `Maaltid-Desktop.dc.html` — Måltid · desktop · sammenlign (the last 5 times) | `Maaltid-Simpel.dc.html` — Måltid · simpleMode · spørg en voksen (photo estimate) | — |
| 4 | Library (Bibliotek / Mad) | `Bibliotek-Telefon.dc.html` — Bibliotek · telefon (list, filters, tick to verify) | `Bibliotek-Desktop.dc.html` — Bibliotek · desktop · godkend (batch verify table + edit panel) | *none* (the simpleMode picker in Log-Simpel is the child's view of the library) | — |
| 5 | History (Historik) | `Historik-Telefon.dc.html` — Historik · telefon (day curve, meals, week summary link) | `Historik-Desktop.dc.html` — Historik · desktop · ugen (week tiles, weekly numbers, questions for the clinic) | *none* | Viewer: `Historik-Viewer.dc.html` — I dag · ser med (viewer): meals and carbs only, no glucose |
| 6 | People (Personer) | `Personer-Telefon.dc.html` — Personer · telefon (members, devices, invite button) | `Personer-Desktop.dc.html` — Personer · desktop · invitér (members table + invite panel with QR) | *none* | — |
| 7 | Settings (Indstillinger / Mere) | `Indstillinger-Telefon.dc.html` — Indstillinger · telefon (source, AI, unit, language, simpleMode per person) | `Indstillinger-Desktop.dc.html` — Indstillinger · desktop (source cards, AI provider, unit/language/target range, simpleMode) | *none* | Accent colour: `Farve-Indstilling.dc.html` — Farve · vælg pr. person |
| 8 | Invite landing (Invitation) | `Invitation-Telefon.dc.html` — Invitation · telefon | `Invitation-Desktop.dc.html` — Invitation · desktop | *none* (the recipient has no settings yet) | — |

Rejected sketches, page *Retninger*: `B-QuietClinic.dc.html` — B · Quiet clinic (skitse); `C-PictureBook.dc.html` — C · Picture book (skitse).

All 30 files in `canvas.json` are accounted for above.

## Navigation model

**Phone (normal mode): five bottom tabs.** `Nu` · `Måltid` (opens Log et måltid) · `Mad` (the library) · `Historik` · `Mere` (settings). Height: 10 px top padding, 48 px items, 28 px bottom inset for the home indicator; 26 px icons, 12 px labels, the active tab in the accent's strong shade at weight 700. Personer and Farve keep the tab bar behind a 44 px back button; Log et måltid keeps it behind a close (×). Portioner, Måltid detail and every simpleMode sub-screen have a back or close button (44 px, 48 px in simpleMode) and no tab bar. The "Log et måltid" primary button sits above the tab bar on Nu.

**Phone (simpleMode): three bottom tabs.** `Nu` · `Min mad` · `Spørg` (ask an adult). 56 px items, 32 px icons, 15 px bold labels. The shell has no settings tab; the child cannot reach settings. Primary actions are 84 px tall ("Jeg spiser nu"), secondary 64 px ("Spørg en voksen").

**Phone (viewer): three bottom tabs, 96 px wide.** `I dag` · `Tidligere dage` · `Mere`, with the header pill "Du ser med". The viewer never sees Nu, Måltid or Mad; the day shows meals and carb totals only, with the notice "Blodsukker vises ikke her".

**Desktop (normal mode): persistent left sidebar, 240 px**, on the sunken paper (`#EEE7DA`). Wordmark "Frejsi", a space switcher card ("Almas rum · Skift rum"), then `Nu` N · `Log et måltid` M · `Bibliotek` B · `Historik` H · `Personer` P · `Indstillinger` ,. The active item has a cream background and weight 700. Footer: current user with role; "Tastaturgenveje · ?" (13 px) is drawn on Nu-Desktop only. Main column: 28/32/40 px padding, max width 1120 px, multi-column with `flex-wrap`. Keyboard: `/` focuses search (shown as a kbd hint in the field), arrows move between meals and Enter opens, `J`/`K` move, Space selects, `V` verifies, `E` edits (Bibliotek), Enter adds a search result ("Enter tilføjer", Log-Desktop), `⌘↩` saves a meal, `←`/`→` previous/next meal.

**Desktop (simpleMode): the same shell, larger.** Sidebar 260 px headed by a 48 px avatar and the person's name in 26 px serif (no wordmark, no space switcher), then 20 px bold items `Nu` · `Min mad` · `Spørg en voksen`, 30 px icons, footer "Simpel visning · slået til af Jonas". Main column 40/48 px padding, glucose at 200 px, a 96 px primary button, and a 4-up grid of photo tiles. It is the same app, not a different one.

**Invite landing** has no navigation at all: wordmark, greeting, the role explained, two reassurance lines, one primary button, the expiry line.

Dark mode follows the system (`prefers-color-scheme`), shown on `Nu-Moerk`: ground `#1F1B17`, cards `#2A2521` with a 1 px border instead of a shadow, olive lifted to `#9DAE78`, meal marker lifted to `#E08A6C`, the glucose number in `#F1EADF`, and the primary button becomes dark text (`#1F1B17`) on the lifted olive.

## Components

Names are the ones the implementation should use. "Variants" are what the artboards actually show.

| Component | Used on | Variants / notes |
|---|---|---|
| `AppShell` | every screen except Invitation | phone-tabs (5), phone-tabs-simple (3), phone-tabs-viewer (3), desktop-sidebar, desktop-sidebar-simple |
| `GlucoseValue` | Nu (all), Log-Desktop header, Farve preview | hero phone 100 px, hero simple 148/200 px, desktop 92 px, inline 22 px, preview 56 px. Always renders number + `TrendArrow` + age line ("for 3 min. siden") + trend word. Never the number alone. Decimal comma in `da`. The Farve preview artboard draws "6,2 ↗ · forbundet" without an age; the implementation renders the live reading with its age there too (hard rule; see Design gaps) |
| `TrendArrow` | with every `GlucoseValue` | 40 px stroke 3.5 (normal), 64/88 px in a tinted circle, stroke 5 (simple), 30 px in the Farve preview, 18 px inline. Words seen: "stiger langsomt", "stabil"; `aria-label` carries the word |
| `SourceStatus` | Nu header, Nu-Desktop status card, Indstillinger, Farve preview | dot (8–10 px, accent) + "Dexcom forbundet" (Nu phone) / "Dexcom Share · sidste måling 15:13" (Nu desktop) / "Dexcom Share · forbundet · sidste måling 15:13" (Indstillinger phone) / "Forbundet · sidste måling i dag 15:13 · EU-server · henter hvert 5. minut" (Indstillinger desktop) / "forbundet" (Farve preview) |
| `GlucoseChart` | Nu, Historik, Måltid, Farve preview | sparkline-3h (phone), day (desktop, 06:00→now), meal −1 h/+4 h (phone and desktop, with faint previous curves), week-tile (120×64). Range band, dashed bounds, meal lines, bolus triangles, end dot, time axis. See `tokens.json#chart` |
| `Card` | everywhere | surface, radius 20 (22 simple, 24 invite desktop), shadow `0 1px 0 hairline`; dark: 1 px border. `Card.list` with hairline-separated rows |
| `ListRow` | Indstillinger, Personer, Bibliotek, Maaltid items, Log results | thumb 44/52 px; title sans 16/700 (settings and people rows) or serif 18 (food rows) + secondary 12–13 px; trailing chevron / switch / verify circle / amount |
| `MealCard` | Nu ("Sidste måltid"), Historik, Historik-Viewer | phone: photo 64 px + serif 19 title + "12:10 · 50 g kulhydrat · Jonas"; timeline row with time column 48 px; simple: "Du spiste kl. 12:10" above the title |
| `PhotoTile` | Log-Telefon favourites (2-up), Log-Simpel (2-up, hero spans 2), Nu-Simpel-Desktop (4-up) | photo 92/104/112/140 px, serif title 17/21/22/26, optional subtitle; selected state: 3 px accent border + tint background + check badge |
| `PrimaryButton` | everywhere | phone 58 px r18; desktop 44–46 px r12–14; simple 84/96 px r22–24; confirm 76 px; accent background, `onAccent` text |
| `SecondaryButton` | Nu-Simpel, Maaltid-Desktop, Personer, Bibliotek-Desktop, Indstillinger-Desktop | surface, 1–2 px hairline/subject border; rectangular r10 36 px on desktop ("Skift login", "Forbind", "Vælg", "Ret"); pill variants on People: "Fjern" 34 px (destructive text `#A3503A`), "+ Tilføj en enhed" 36 px, "Send igen" 32 px |
| `Chip` | Log recent, Bibliotek filters, Log-Desktop modes, Maaltid-Desktop toggles, Indstillinger-Desktop provider, Farve person chips | pill r999, 36–40 px; pressed: 2 px accent border + tint + strong text. Unverified filter uses the terracotta pair. Person chips carry a 28 px avatar |
| `PortionChips` | Log-Portioner, Log-Desktop | 46 px chips "½ skive · 9 g", "1 skive · 18 g", "2 skiver · 36 g", "Vej det"; desktop adds a grams input chip |
| `Badge` | Log, Bibliotek, Maaltid-Simpel, Personer-Desktop | `Ikke tjekket` (terracotta), `Tjekket` (accent tint), `Et gæt · ikke tjekket` (terracotta), `Simpel visning` (accent tint), `Observation · AI` (outlined, muted) |
| `VerifyCircle` | Bibliotek-Telefon | 44 px: outlined accent button (unverified) or filled tint with check (verified, `role=img`) |
| `Switch` | Indstillinger (AI, simpleMode per person) | 52×32, knob 26; on = accent, off = `#C9BFA9` |
| `SegmentedControl` | Indstillinger (mmol/L · mg/dL, Dansk · English) | track `#EEE7DA` r999 padding 3; selected segment surface + shadow + 700 |
| `SearchField` | Nu-Desktop, Log, Bibliotek | phone 50 px r16; desktop 44–54 px r14–16; leading search or barcode icon; trailing kbd `/` or hint "Skriv, eller scan med en USB-scanner" |
| `EntryTiles` | Log-Telefon | 3-up, 104 px: Scan · Sig det · Vælg |
| `StatTile` | Maaltid, Historik-Desktop | label 12 muted, value 22–26 700 tabular, footnote 12 muted; 3-up (meal) or 2-up (week) |
| `Observation` | Maaltid, Historik-Desktop | `Observation · AI` badge + "ud fra tallene, ikke et råd" + one sentence 15 px; week: numbered list "Spørgsmål til klinikken" with Ret/Kopiér |
| `DataTable` | Nu-Desktop (today's meals), Maaltid-Desktop (last 5 times), Bibliotek-Desktop (batch verify), Personer-Desktop (members) | 13 px muted headers, hairline rows, tabular numerals, body 15 px (14 px on People), selected row `#F3EEE3`, a keyboard hint (Nu) or a notice (People) under the table |
| `BatchBar` | Bibliotek-Desktop | tint strip above the table: "2 valgt" · Godkend valgte (V) · Fjern fra biblioteket |
| `EditPanel` | Bibliotek-Desktop | name, carbs per 100 g, portion rows (name + grams, "+ Portion"), OFF contribution checkbox, Gem og godkend / Gem |
| `MemberRow` / `DeviceRow` | Personer | avatar 44, name (dig), role · devices; expanded: device rows with "Face ID · sidst set i dag 14:52", Fjern, "+ Tilføj en enhed" |
| `InvitePanel` | Personer-Desktop | name field, role radio cards (Hjælper / Ser med / Ejer with one-line explanations), QR 96 px + "Gælder i 7 dage · kan bruges én gang", Kopiér link / Ny invitation |
| `SourceCard` | Indstillinger-Desktop | radio-style cards Dexcom Share (selected, 2 px accent, tint) / Nightscout / Manuelt, each with a one-line description and a button (Skift login / Forbind / Vælg) |
| `ColourPicker` | Farve-Indstilling | person chips (avatar + name), five 52 px swatches with names, live preview card, two explanatory lines |
| `Avatar` | everywhere | initial on a tinted circle: 28 (sidebar footer), 32, 36, 44, 48 (simple), 72/88 (invite); dashed outline for a pending invite |
| `Notice` | Historik-Viewer, Indstillinger, Personer | muted paragraph 12–14 px, optionally on `#EEE7DA` / `#F3EEE3`; the viewer notice, the AI data notice, the device notice, the "regner aldrig insulin" footer |
| `SimpleActionPair` | Nu-Simpel (both) | "Jeg spiser nu" (84/96 px, accent) over "Spørg en voksen" (64/72 px, outlined) |
| `TotalBar` | Log-Portioner, Log-Simpel, Log-Desktop | sticky bottom: "I alt" + "50 g kulhydrat" 28 px + Gem måltid; simple: dish name + "42 g kulhydrat" + "Ja, det spiser jeg" |
| `PageHeader` | every sub-screen | phone: 44 px back (48 simple) + centred 24 px serif h1 + 44 px spacer, or 26 px h1 left with a trailing action; desktop: 30 px serif h1 + 14 px muted subtitle |
| `SectionNav` | Indstillinger-Desktop | left column 180–220 px of anchor links (Glukosekilde, AI-hjælp, Enhed og sprog, Simpel visning, Data og eksport), item `10px 12px` r10, active = surface + shadow + 700 |
| `SpaceSwitcher` | desktop sidebar | cream card r14 with avatar 32, "Almas rum" 15/700, "Skift rum" 12 muted, chevron |
| `ViewerPill` | Historik-Viewer header | "Du ser med", 13 px, `4px 10px`, 1 px hairline, r999 |
| `RadioCard` | Personer-Desktop (roles), Indstillinger-Desktop (sources, as `SourceCard`) | r12–14, selected 2 px accent + tint, title 700 + one-line explanation; a 10 px dot or a native radio |
| `QuickLinkCard` / `StatusCard` | Nu-Desktop | r16, `14px 18px`, 36 px icon tile r10 on `#F6E3DB` / `#E9ECDF`, title 15/700 + 13 muted, chevron; status card lists label/value rows |
| `TextInput` / `NumberInput` | Personer-Desktop, Indstillinger-Desktop, Bibliotek-Desktop | 42 px r10 on `#FFFFFF` with a 13 px muted label above; small 36 px × 56 px for the target range |
| `QrCode` | Personer-Desktop invite panel | 96 px square r10 on surface with a hairline |

## Per-person accent colour

`Farve-Indstilling.dc.html` adds a setting the brief did not ask for: each person picks their own accent from five named colours — **Oliven** (default, `#5A6A3B`), **Blomme** (`#5B3F73`), **Hav** (`#3B5F7E`), **Skov** (`#2F6B5E`), **Granat** (`#7A3A4B`). It is a per-user presentation setting like `simpleMode`, settable by an owner for anyone and by the person themselves under Mere. The copy fixes the rules: "Den ændrer kun udseendet – aldrig hvad et tal betyder" and "Måltider er altid teglrøde, og tallet er altid sort – uanset farve". The accent moves with the person across devices, so it belongs on `users`, not on the device. The five `Farve-Nu-*` artboards show the Nu screen in each colour. Code identifiers are the English names (`olive`, `plum`, `sea`, `forest`, `garnet`); the Danish names are UI strings.

## Dark mode

System-driven. One artboard, `Nu-Moerk.dc.html`, fixes the dark palette for the olive accent (see `tokens.json#color.dark`). Cards lose the hairline shadow and gain a 1 px `#3A332C` border; the primary button is dark text on the lifted olive. Everything else keeps its structure.

## Danish vocabulary (glossary)

| Danish (UI) | English | Where |
|---|---|---|
| Nu · Lige nu | Now · right now | tab, Nu header |
| Dit tal lige nu | your number right now | Nu simpleMode |
| for 3 min. siden | 3 min ago (age of the reading) | every glucose value |
| stiger langsomt · stabil | rising slowly · steady | trend words |
| Dexcom forbundet · Forbundet | Dexcom connected · connected | source status |
| sidste måling 15:13 | last reading 15:13 | source status |
| Seneste 3 timer | last 3 hours | sparkline |
| Mål 4–10 · I mål 4–10 · Mål-område | target 4–10 · in range 4–10 · target range | charts, stats, settings |
| måltid · Log et måltid · Måltid | meal · log a meal · meal (tab, detail) | |
| Sidste måltid · Du spiste kl. 12:10 | last meal · you ate at 12:10 | Nu, Nu simpleMode |
| Jeg spiser nu · Ja, det spiser jeg | I'm eating now · yes, I'm eating that | simpleMode |
| Hvad spiser du? | what are you eating? | Log simpleMode |
| Spørg en voksen · Spørg | ask an adult · ask | simpleMode |
| Det er et gæt · Et gæt · ikke tjekket · ca. | it's a guess · a guess · not checked · approx. | AI estimate |
| Ikke tjekket · Tjekket · Godkend valgte · Gem og godkend · Gennemgå og godkend | not checked · checked · verify selected · save and verify · review and verify ("godkend" = verify; the bare imperative appears only in aria labels, "Godkend Rugbrød …") | library |
| Egen ret · Gem som egen ret · Jeg kender tallet selv | own dish · save as own dish · I know the number myself | lookup sources |
| Min madpakke · Favoritter · Spist for nylig · Hele biblioteket | my lunchbox · favourites · eaten recently · the whole library | Log |
| Scan · Sig det · Vælg | scan · say it · pick | Log entry points |
| Vej det · ½ skive · 1 skive · 2 skiver · 1 skål · 1 portion · 1 mellem | weigh it · ½ slice · 1 slice · 2 slices · 1 bowl · 1 portion · 1 medium | portions |
| kulhydrat · g pr. 100 g · I alt | carbohydrate · g per 100 g · total | everywhere |
| Gem måltid · Annullér · Ret · Tag et billede · Vedhæft billede | save meal · cancel · edit · take a photo · attach a photo | Log |
| Bolus givet nu · Bolus 11:58 · Bolus før måltid | bolus given now · bolus 11:58 · bolus before meal | the only insulin concept: a timestamp |
| Hvad skete der bagefter · Sidste 3 gange bagved · Tidligere gange | what happened afterwards · last 3 times behind · previous times | meal curve |
| Top · efter 1 t 05 min | peak · after 1 h 05 min | stats |
| Observation · AI · ud fra tallene, ikke et råd | observation · AI · from the numbers, not advice | AI insight label |
| Spørgsmål til klinikken · Ugens opsummering · Ugens tal · Gem som PDF til klinikken | questions for the clinic · weekly summary · the week's numbers · save as PDF for the clinic | History desktop |
| Mad · Bibliotek · Fødevare · Ny fødevare | food · library · food item · new food item | tab (phone) / sidebar (desktop) |
| Fra Open Food Facts · Fra Frida · AI fra billede | from Open Food Facts · from Frida · AI from photo | origin labels |
| Send rettelsen til Open Food Facts, så andre får gavn af den | send the fix to Open Food Facts so others benefit | library edit |
| Historik · I dag · Tidligere dage · Ugen · Dag · Måltider | history · today · earlier days · the week · day · meals | |
| Ser med · Du ser med · ingen glukose · Blodsukker vises ikke her | viewer (lit. "watching along") · you are watching along · no glucose · blood sugar is not shown here | viewer role |
| Ejer · Hjælper · Ser med | owner · carer · viewer | roles |
| Personer · Personer og enheder · Enheder · + Tilføj en enhed · Fjern · Sidst set · sidst set i dag 14:52 | people · people and devices · devices · add a device · remove · last seen | People. "Enhed" is a homonym on these screens: the Settings row "Enhed" (mmol/L · mg/dL) means the glucose unit; use two i18n keys (`unit`, `device`), never one |
| Invitér en person · 1 invitation venter · Invitation sendt i går · udløber om 6 dage · Send igen · Kopiér link · Ny invitation · Gælder i 7 dage · kan bruges én gang | invite a person · 1 invitation pending · invitation sent yesterday · expires in 6 days · send again · copy link · new invitation · valid 7 days · single use | People |
| Hej Søren, du er inviteret til Almas rum. · Opret adgang med Face ID · Opret adgang med denne computer · Linket gælder i 6 dage endnu og kan kun bruges én gang. | Hi Søren, you're invited to Alma's space. · create access with Face ID · create access with this computer · the link is valid 6 more days and can be used only once. | Invitation |
| rum · Almas rum · Skift rum | space · Alma's space · switch space | |
| Mere · Indstillinger | more (phone tab) · settings (desktop) | |
| Glukosekilde · Skift login · Forbind · Manuelt · Fingerprik-målinger | glucose source · change login · connect · manual · finger-prick readings | Settings |
| AI-hjælp · Udbyder · Højst 50 kald om dagen | AI help · provider · at most 50 calls a day | Settings |
| Enhed · Enhed og sprog · Glukose vises i · mmol/L · mg/dL · Sprog · Dansk · English | unit · unit and language · glucose is shown in · language | Settings |
| Simpel visning · Stor, billedbaseret og kun tjekket mad. Pr. person. | simple view (simpleMode) · large, picture-based, verified food only. Per person. | Settings |
| Farve · Oliven · Blomme · Hav · Skov · Granat | colour · olive · plum · sea · forest · garnet | accent setting |
| Tastaturgenveje | keyboard shortcuts | desktop sidebar |
| Frejsi · åben kildekode · regner aldrig insulin | Frejsi · open source · never calculates insulin | footers |

The copy consistently uses "tjekket" for verified, "et gæt" for an AI estimate, "ser med" for the viewer role and "rum" for a space. Keep those; do not introduce synonyms.

## Design gaps

What the spec or brief needs that no artboard shows. Each is a decision for the implementing plan (or a small follow-up design), recorded so nobody invents it silently.

1. **Source-disconnected banner** (spec §3, §7): the owner banner "Dexcom connection down since 14:05" has no artboard and no Danish copy. Only the connected state is drawn (`SourceStatus`). The disconnected state needs a dot colour, a banner placement on Nu (phone and desktop) and the copy.
2. **Dark mode beyond Nu and beyond olive**: `Nu-Moerk` is the only dark artboard. Dark values for the other four accents, for the sidebar, the tint (`#E9ECDF`) and the unverified badge, and dark versions of every other screen, are not drawn. Derive them by the same rules (lift the accent, border instead of shadow).
3. **Accent tints for Hav, Skov, Granat**: only Blomme shows its selected-chip tint (`#EAE3EF`). The other three need a tint for selected chips and badges.
4. **Trend words**: only "stiger langsomt" and "stabil" appear. Dexcom has seven trend values plus "not computable"; the remaining words and arrow angles are not drawn.
5. **Stale, missing and out-of-range readings**: no artboard shows a reading older than a few minutes, a gap in the curve (sensor change), a value above the chart's top, or "no reading yet" on a new space. The age line is the only staleness signal drawn.
6. **Loading, empty and error states**: no empty library, no empty day, no failed save, no offline state (PWA).
7. **Tablet**: the brief says tablet inherits; no tablet artboard exists. The 390/1280 artboards fix the two ends; the switch-over width is not drawn.
8. **Barcode scanner UI** (camera view on phone) and the **voice capture UI** ("Sig det"): entry tiles exist, the screens behind them do not.
9. **Add-device flow**: the "+ Tilføj en enhed" button and the "tilføj enhed"-link copy exist; the resulting link/QR view and what the existing user sees on the new device are not drawn (the Invitation screen is the closest).
10. **First-run / bootstrap**: how the very first owner gets in before any invite exists is not designed.
11. **Space switcher**: "Skift rum" is a card in the sidebar; the switcher itself (a user in several spaces) and the phone equivalent are not drawn.
12. **Keyboard-shortcut help** ("Tastaturgenveje · ?") panel is not drawn; the shortcuts themselves are listed as hints on each desktop screen.
13. **Settings on phone** lacks the target range ("Mål-område") and the "Data og eksport" section that the desktop shows; the desktop sidebar link "Data og eksport" has no section drawn.
14. **mg/dL rendering**: every artboard is mmol/L with a decimal comma. Whole-number mg/dL layouts (three digits in the hero) are not drawn.
15. **English (`en`) copy**: all artboards are Danish. English strings are the implementer's, reviewed by the copy-reviewer.
16. **Push notification for "Spørg en voksen"**: "Jonas og Mette får besked med det samme" is promised; the notification and what the carer sees are not drawn.
17. **Viewer on desktop**: only a phone artboard exists for the viewer.
18. **The "foto" placeholders**: no real photo treatment (crop, aspect, thumbnails) is specified beyond the tile sizes.
19. **Farve entry point**: neither `Indstillinger-Telefon` nor `Indstillinger-Desktop` has a "Farve" row or section, although `Farve-Indstilling` backs to Indstillinger and says "Alma kan også selv skifte under Mere"; no desktop Farve layout exists.
20. **Farve preview without age**: the preview card draws "6,2 ↗ · forbundet" with no age line, which the hard rule forbids; the implementation shows the live reading with its age.
21. **Connect Dexcom Share form** (username, password, region): "Skift login" is the only trace; the form is not drawn.
22. **Settings for non-owners**: the desktop subtitle says "kun ejere kan ændre her"; what a carer or viewer sees (own language, view and colour) is not drawn.
23. **Returning sign-in, the unauthenticated page and invite error states** (expired, used, revoked): not drawn; the Invitation screen is the closest.
24. **Phone invite form and member actions**: "Invitér en person" on the phone links nowhere; the name/role/QR form exists only as the desktop panel; change role, remove member and the phone member detail are not drawn.
25. **Viewer in v0.1.0 and on desktop**: the viewer shell exists only on `Historik-Viewer`, whose content is v0.2.0; what a viewer lands on before meals exist is undrawn.
26. **Now without meals**: "Sidste måltid", "Dagens måltider", the quick-link cards, "Min mad" and the last-meal card are v0.2.0+ content; their absence in v0.1.0 is not drawn (the plan omits them rather than drawing them empty).
27. **Copy the plan adds** because no artboard has it: "Ingen målinger endnu", "Kommer i en senere version", "Log ind", "Ingen forbindelse til {source} siden {time}", the invite error page, and the non-owner Settings subtitle.

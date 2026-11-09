# App Store listing, Danish (da)

The text for App Store Connect's Danish localisation, field by field. Copy the text inside each
fenced block as it is. The limits are Apple's; `checklist.md` says how the lengths were checked.
The English localisation is `listing.en.md`, with the same content.

Rules this copy keeps (plan `docs/superpowers/plans/2026-11-08-ios-follower-app.md` §6): it shows
data from the user's own Nightscout site, it is not medical equipment, it makes no treatment
decisions, it does not replace the CGM app and its alarms, CarPlay is only "see it on the CarPlay
screen", and there is nothing about medication or treatment advice.

## App name (max 30)

```text
nænsom
```

## Subtitle (max 30)

```text
Blodsukkeret på låseskærmen
```

## Promotional text (max 170)

```text
Følg blodsukkeret fra jeres egen Nightscout-side på låseskærmen, i Dynamic Island og på CarPlay-skærmen. Altid med, hvor gammel målingen er.
```

## Description (max 4000)

```text
nænsom viser blodsukkeret fra jeres egen Nightscout-side, så du kan følge med uden at åbne en app. Den er lavet til forældre, bedsteforældre, lærere, pædagoger og andre, der gerne vil kunne se, hvordan det går.

nænsom kræver en Nightscout-side, som en CGM sender målinger til.

SÅDAN KOMMER DU I GANG
Den, der passer Nightscout-siden, sender dig et link. Tryk på det på din iPhone, så sætter nænsom sig selv op. Du kan også scanne linkets QR-kode eller skrive sidens adresse og et token, der kun kan læse.
Vil du først se, hvordan det virker, så tryk på "Prøv demoen". Den viser opdigtede målinger.

DET VISER nænsom
• Den seneste måling med pil, ændringen siden sidst, og hvor gammel målingen er, fx "3 min siden".
• En kurve over de seneste 3, 6 eller 12 timer.
• En Live Activity på låseskærmen og i Dynamic Island. nænsoms server holder den opdateret med hver ny måling, også når appen er lukket.
• Den samme Live Activity i Smart Stack på Apple Watch og på CarPlay-skærmen, så du også kan se den der.
• Widgets til hjemmeskærmen og låseskærmen.
• Farver efter jeres egne grænser: grøn mellem lav og høj, gul uden for, rød ved eller forbi de akutte værdier og grå, når målingen er mere end 15 minutter gammel. Grænserne kommer fra Nightscout-siden, og du kan selv justere dem.
• mmol/L eller mg/dL.
• Dansk og engelsk.

PÅMINDELSER VED LAV OG HØJ
Hvis du vil, sender nænsom en besked, når blodsukkeret går under lav eller over høj, og når der ikke er kommet nye målinger i 20 minutter. Det er en påmindelse: den følger lydløs og Fokus som alle andre beskeder og erstatter ikke CGM-appens alarmer.

GODT AT VIDE
• nænsom viser data fra jeres egen Nightscout-side. Den læser kun og ændrer aldrig noget på siden.
• nænsom er ikke medicinsk udstyr. Den træffer ingen beslutninger om behandling og giver ingen råd om behandling.
• Behold CGM-appen og dens alarmer. nænsom viser blodsukkeret; den overvåger det ikke.
• Hver måling vises med sin alder, så en gammel værdi aldrig ligner en ny.

PRIVATLIV
Sidens adresse og tokenet ligger på din telefon og hos nænsoms server i Vesteuropa, som holder Live Activity opdateret. Serveren gemmer ingen målinger, kun tidspunktet for den seneste. Ingen reklamer og ingen sporing. Med "Fjern denne telefon" i Indstillinger sletter du det hele igen med ét tryk.

nænsom er gratis.
```

## Keywords (max 100, comma-separated, no spaces after commas)

Words already in the name or subtitle are left out (Apple indexes those anyway). No other app's or
brand's name: "nightscout" is the open-source site the app reads, named in the description too.

```text
glukose,diabetes,cgm,nightscout,følger,live activity,widget,type 1,mmol,måling,forælder,barn
```

## What's New in 0.1.0 (max 4000)

App Store Connect shows no "What's New" field for an app's first version; keep this for the record
and for 0.1.x if the first submission is rejected and resubmitted as a new version.

```text
Den første version. Følg blodsukkeret fra jeres egen Nightscout-side i appen, på låseskærmen, i Dynamic Island og på CarPlay-skærmen, med farver efter jeres egne grænser og påmindelser ved lav og høj.
```

## Other fields

| Field              | Value                                  |
| ------------------ | -------------------------------------- |
| Support URL        | `https://naensom.jepsen.ninja/support` |
| Privacy Policy URL | `https://naensom.jepsen.ninja/privacy` |
| Marketing URL      | none                                   |
| Primary category   | Medical                                |
| Secondary category | none                                   |
| Age rating         | 4+ (answers in `checklist.md`)         |
| Price              | Free                                   |
| Copyright          | `2026` and the account holder's name   |

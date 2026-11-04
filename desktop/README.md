# Frejsi desktop glance (Windows)

A small Windows app that shows the current glucose where you can see it while you work: a tile in the notification area with the value in the range colour, and a little always-on-top card with the value, the trend arrow, the change since the last reading and, always, how old the reading is.

It reads from a [Nightscout](https://nightscout.github.io/) site, not from Frejsi's own API, because Frejsi signs people in with passkeys and has no device tokens yet; a Frejsi token is the planned next step, so the glance can follow the same space as the web app. Until then it is the same readings by another road: the Nightscout site the pump record already uses (`README.md`, "The pump's own record").

Like the rest of Frejsi it only reads, has no alarms, and never says anything about insulin. Keep the CGM app and its alarms; this is a glance, not a monitor.

## Install

1. Download `FrejsiDesktop.exe` from the newest `desktop-v*` entry on the [releases page](https://github.com/nicklasjepsen/frejsi/releases) and put it somewhere that stays, like `C:\Users\<you>\Apps\`.
2. Run it. Windows SmartScreen warns about an unknown publisher the first time: "More info" → "Run anyway".
3. The settings window opens. Type the site's address, paste an access token, press **Test connection**, then **Save**.

The token should be read-only: on the Nightscout site, **Admin tools → Subjects**, add a subject with the `readable` role and copy its token. The app stores it encrypted for your Windows account (DPAPI) under `%AppData%\Frejsi\Desktop\settings.json`; nothing else leaves the machine.

## Use

- **Tray tile**: the value on a green, amber or red tile (in range, high, low). When the newest reading is more than 15 minutes old the tile goes grey and shows `--`, because the tile has no room for the age and a glucose value is never shown without it. Hover for the value, arrow and age.
- **Card**: drag it anywhere; it remembers where. Left-click the tray tile to show or hide it. Double-click the card, or right-click either, for settings. It follows Windows' dark or light mode.
- **Thresholds**: low below 3.9, high above 10.0 mmol/L by default; change them, or the unit, in settings. Colours only, no alarms.
- **Start with Windows**: a checkbox in settings, which adds the app to your account's start-up apps (Task Manager → Startup shows it as FrejsiDesktop).

## Build

Needs the .NET 10 SDK. From this folder:

```
dotnet test tests/BgTray.Core.Tests
dotnet publish src/BgTray -c Release -r win-x64 --self-contained -p:PublishSingleFile=true -o publish
```

`BgTray.Core` (the Nightscout reader, unit conversion, arrows, ranges, ages) builds and tests on any OS; the WPF app in `src/BgTray` compiles anywhere but runs on Windows. `.github/workflows/desktop.yml` runs the tests on every change under `desktop/`, keeps the exe as a workflow artifact on `main`, and publishes it as a GitHub release on a `desktop-vX.Y.Z` tag. It is outside the web app's CI and the `vX.Y.Z` release pipeline, and deploys nothing.

# Curve fixtures

Hand-written, deterministic fictional readings, not recordings from a person or vendor.
All readings and target bounds use canonical mmol values and carry ISO timestamps.
`meal-mgdl-space.json` deliberately retains the same values: display conversion belongs to the client.

- `meal-typical.json`: readings every five minutes from -60 to +240 minutes; 9.6 at +65 minutes is the three-hour peak. A 15.0 at +200 minutes is chart context only.
- `meal-gap.json`: the same curve with +90 through +110 removed. The +85 to +115 interval is entirely uncovered, leaving 150 covered minutes in the three-hour window.
- `meal-in-progress.json`: the same curve ending at +80 minutes. Pass +80 minutes as `now`.
- `day-with-night-lows.json`: the full local day of 2026-10-14 in the named timezone, including the following midnight as the final successor; two 20-minute low runs at 02:00 and 03:10, with 50 minutes of recovery between them. Coverage is 1440 minutes, 1400 in range.

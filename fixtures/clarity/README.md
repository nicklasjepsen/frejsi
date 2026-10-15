# Dexcom Clarity export fixtures

Hand-written files in the shape of Clarity's CSV export (Clarity → Export), for
`shared/src/glucose/import/clarity.test.ts` and the import route tests. Every name, device id,
transmitter id and value is fictional; no file here came from a real export.

- `clarity-export-mmol.csv`: the EU layout in mmol/L with the patient, device and alert rows
  Clarity writes first, `EGV` readings including one `High` and one `Low`, a duplicated row,
  two `Carbs` entries, and rows of every other type Clarity writes (which the parser counts and
  never reads beyond their type).
- `clarity-export-mgdl.csv`: the US layout in mg/dL with the newer space-separated,
  non-padded timestamp.
- `clarity-export-semicolon.csv`: a locale that writes `;` between columns and `,` as the decimal.
- `clarity-export-da.csv`: a Danish-locale export in the shape a Danish Clarity account writes
  (UTF-8 with BOM, CRLF, `;` between columns, every field quoted, `,` as the decimal): the Danish
  header and event types, the patient, device and `Advisering` rows, `Estimeret glukoseværdi`
  readings including one `Høj`, one `Lav` and one without a value, one `Kulhydrater` entry and
  one dosing row. Its structure mirrors a real export; every value in it is made up.

Frejsi reads readings and carb entries from these and nothing else; the dosing rows exist in the
fixtures only so the tests can prove they leave no trace.

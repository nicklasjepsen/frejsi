# Bundled Frida dataset

Source: **The Danish Food Composition Database, version 6.1 (May 2026)**,
published by the National Food Institute, Technical University of Denmark (DTU).
DTU's Frida site now calls the dataset FCDB; the Frejsi plugin id remains `frida`.

- Dataset: https://doi.org/10.11583/DTU.32312844 (published 2026-06-09).
- Metadata and file licence: https://api.figshare.com/v2/articles/32312844
- Download: https://ndownloader.figshare.com/files/65016537
  (`FCDB_6.1_Dataset.xlsx`), retrieved **2026-10-15**.
- Source XLSX SHA-256: `aba52ade9dd75f085954ca5561f001efb58e4b37d412b135622fd34d77f45c09`.
- Projected CSV SHA-256: `b370bfafdc9cc4ecd0915f3e79c949e946861710771a366241713ee164518a3e`.
- Output: 1,389 foods, sorted numerically by id, one decimal gram per 100 g.

## Licence and attribution

The repository's AGPL applies to code. **The dataset is CC BY 4.0**, as explicitly
listed for `FCDB_6.1_Dataset.xlsx` in the publisher's metadata. Redistribution and
adaptation are permitted with attribution. The full licence text is included in
[LICENSE-CC-BY-4.0.txt](LICENSE-CC-BY-4.0.txt), also available at
https://creativecommons.org/licenses/by/4.0/legalcode.en . DTU's workbook states:
“Data and texts from http://fcdb.fooddata.dk may not be copied or otherwise
reproduced without clear source information.”

Attribution line for this derived dataset:

> The Danish Food Composition Database, version 6.1, May 2026. National Food
> Institute, Technical University of Denmark. https://doi.org/10.11583/DTU.32312844 .
> CC BY 4.0. Adapted for Frejsi: selected names, groups and available carbohydrate;
> carbohydrate rounded to one decimal, entries without that value omitted.

Names and nutrition in this production dataset describe generic foods from DTU;
test foods and test nutritional values are fictional. The dataset contains no
personal records. It supplies unverified candidates, not a family's verification.

## Refresh

Download the pinned XLSX above (or select and document a newer DTU release).
Verify its hash and licence again. Save it locally as `/tmp/frejsi-frida.xlsx`.
Export a projection of `Data_Table` joined to the `Food` sheet for its English
food-group name. The following Python 3 standard-library conversion is the one
used for this committed output; it needs no spreadsheet library:

```python
import csv
import xml.etree.ElementTree as E
import zipfile

z = zipfile.ZipFile('/tmp/frejsi-frida.xlsx')
ns = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
strings = [''.join(n.itertext()) for n in E.fromstring(z.read('xl/sharedStrings.xml'))]

def rows(sheet):
    root = E.fromstring(z.read('xl/worksheets/' + sheet + '.xml'))
    for row in root.findall('.//s:row', ns):
        yield {
            ''.join(filter(str.isalpha, c.attrib['r'])):
                strings[int(c.findtext('s:v', '0', ns))]
                if c.attrib.get('t') == 's' else c.findtext('s:v', '', ns)
            for c in row
        }

groups = {r.get('C'): r.get('M', '') for r in list(rows('sheet4'))[1:]}
with open('/tmp/frejsi-frida.csv', 'w') as f:
    w = csv.writer(f)
    w.writerow(['FoodID', 'FødevareNavn', 'FoodName', 'FoodGroup',
                'Available carbohydrates', 'Carbohydrate by difference', 'Dietary fibre'])
    for r in list(rows('sheet2'))[4:]:
        if r.get('C', '').isdigit():
            w.writerow([r['C'], r.get('A', ''), r.get('B', ''), groups.get(r['C'], ''),
                        r.get('L', ''), r.get('K', ''), r.get('N', '')])
```

`Data_Table` row 2 labels column L “Available carbohydrates”; row 4 identifies
parameter **172**. Column K (parameter 170, carbohydrate by difference) and M
(parameter 318, available carbohydrate labelling) are deliberately not used.
Column N holds dietary fibre; it is not subtracted again from parameter 172.
The source values are grams per 100 g edible food. Re-check these coordinates
against the headers before exporting a future release; never silently switch
nutrients when DTU changes its layout.

Run from the repository root:

```sh
pnpm --filter ./shared frida:import /tmp/frejsi-frida.csv
pnpm --filter ./shared frida:import /tmp/frejsi-frida.csv /tmp/frida-check.json
cmp shared/src/food/frida/data/frida.json /tmp/frida-check.json
pnpm --filter ./shared test src/food/frida
```

The importer accepts UTF-8 CSV with comma or semicolon separators, optional BOM,
quoted multiline fields and decimal dots or commas. Blank/NULL/NA available
carbohydrate values are omitted; zero is retained. Invalid values and duplicate
food ids fail before writing. Commit the generated JSON and update this provenance
record together. The XLSX/CSV stays outside the repository; tests use the fictional
excerpt and never download source data. Everything is bundled for offline lookup.

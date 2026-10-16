# Recorded OFF response shapes

Hand-written fixtures in OFF's documented v2 product and legacy text-search
response formats. Foods, brands, quantities and nutritional values are fictional;
all example barcodes are in restricted-circulation ranges. No production product
response or image is stored. `rate-limited.json` accompanies HTTP 429.

The fixture fetch in `shared/src/food/off/source.test.ts` records URLs/options and
serves these files without network access. Search results deliberately repeat the
barcode product so country/world deduplication is exercised.

## Write responses

`write-*.json` are hand-written shapes of the `product_jqm2.pl` write endpoint's
JSON reply: `write-ok.json` (`status: 1`), `write-not-logged-in.json` and
`write-rejected.json` (`status: 0` with a different `status_verbose`) and
`write-rate-limited.json` (accompanies HTTP 429). The accounts, passwords and
barcodes used with them in tests are fictional; no test writes to OFF.

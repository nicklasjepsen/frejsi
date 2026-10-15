# Recorded OFF response shapes

Hand-written fixtures in OFF's documented v2 product and legacy text-search
response formats. Foods, brands, quantities and nutritional values are fictional;
all example barcodes are in restricted-circulation ranges. No production product
response or image is stored. `rate-limited.json` accompanies HTTP 429.

The fixture fetch in `shared/src/food/off/source.test.ts` records URLs/options and
serves these files without network access. Search results deliberately repeat the
barcode product so country/world deduplication is exercised.

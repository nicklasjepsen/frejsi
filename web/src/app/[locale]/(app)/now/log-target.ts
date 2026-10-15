import { normaliseBarcode } from "@frejsi/shared/food/barcode";

/**
 * Where Enter in the Nu-Desktop header goes: a valid 8, 12 or 13 digit code is a barcode, as a
 * USB scanner types it (decision 32); anything else is a search. Null for an empty field.
 */
export function logTarget(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  const query = new URLSearchParams(normaliseBarcode(text) ? { barcode: text } : { q: text });
  return `/log?${query.toString()}`;
}

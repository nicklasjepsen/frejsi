/** Validate EAN-8, EAN-13 or UPC-A; use EAN-13 as the canonical UPC-A representation. */
export function normaliseBarcode(value: string): string | null {
  if (!/^(?:\d{8}|\d{12}|\d{13})$/.test(value)) return null;
  const body = value.slice(0, -1);
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    sum += Number(body[body.length - 1 - i]) * (i % 2 === 0 ? 3 : 1);
  }
  if ((10 - (sum % 10)) % 10 !== Number(value.at(-1))) return null;
  return value.length === 12 ? `0${value}` : value;
}

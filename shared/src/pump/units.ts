/**
 * Unit display for pump history (v0.7.0 plan §7): "2,4 E" in `da`, "2.4 U" in `en`. It formats a
 * number the pump recorded and computes nothing from it; the bare letters are not dosing words,
 * and the copy-reviewer reads the pump namespaces line by line.
 */
const UNIT_LETTER = { da: "E", en: "U" } as const;
const NUMBER_LOCALE = { da: "da-DK", en: "en-GB" } as const;

export type UnitsLocale = keyof typeof UNIT_LETTER;

export function formatUnits(value: number, locale: UnitsLocale): string {
  const number = new Intl.NumberFormat(NUMBER_LOCALE[locale], {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
  return `${number} ${UNIT_LETTER[locale]}`;
}

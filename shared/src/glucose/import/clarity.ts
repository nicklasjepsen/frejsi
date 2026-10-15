import { parse } from "csv-parse/sync";

import { Reading } from "../../schemas/glucose";
import { MGDL_PER_MMOL, mgdlToMmol } from "../units";
import { localToUtc } from "./local-time";
import { trendFromRate } from "./trend";
import {
  GlucoseImportError,
  type GlucoseImportOptions,
  type GlucoseImportParse,
  type GlucoseImportSource,
  type ImportedCarbs,
} from "./types";

/**
 * Dexcom Clarity's CSV export (Clarity → Export). One header row, then a few rows of patient,
 * device and alert settings, then one row per event, oldest first. The columns this reads, by
 * the start of their header (the unit is in the glucose header, the timestamp format in its own):
 *
 *   Index, Timestamp (YYYY-MM-DDThh:mm:ss), Event Type, Event Subtype, Patient Info, Device Info,
 *   Source Device ID, Glucose Value (mmol/L | mg/dL), …, Carb Value (grams), …,
 *   Glucose Rate of Change (mmol/L/min | mg/dL/min), Transmitter Time (Long Integer), Transmitter ID
 *
 * Clarity writes the header and the event types in the account's language, and some locales
 * quote every field, put `;` between columns and write a comma decimal. Columns are therefore
 * found by role, not by their English name, and event types by a synonym set per role.
 *
 * Event types: a reading (`EGV`; `Low`/`High` for a value past the sensor's range) and a carb
 * entry from the Dexcom app (`Carbs`). Every other type (calibrations, exercise, health, alerts,
 * the patient rows and the dosing rows, in any language) is counted and otherwise left unread.
 * Timestamps are wall-clock times without an offset; the space's timezone places them.
 */

/**
 * The start of each column's header, per language, lower case. To add a language, add the header
 * starts from a real export in that language next to the others; do not guess them.
 */
const COLUMNS = {
  timestamp: ["timestamp", "tidsstempel"],
  type: ["event type", "hændelsestype"],
  subtype: ["event subtype", "hændelsesundertype"],
  glucose: ["glucose value", "glukoseværdi"],
  carbs: ["carb value", "kulhydratværdi"],
  rate: ["glucose rate of change", "ændringshastighed for glukose"],
} as const satisfies Record<string, readonly string[]>;

/**
 * The event types this reads, per role, lower case, in every language it knows. The Danish carb
 * name is inferred from the Danish carb column's header ("Kulhydratværdi"); no Danish export seen
 * so far held a carb row. Any type not listed here is never read beyond its name.
 */
const EVENT_TYPES = {
  reading: new Set(["egv", "estimeret glukoseværdi"]),
  carbs: new Set(["carbs", "kulhydrater"]),
} as const;

/** Clarity's sensor range, as the Dexcom app shows it: 2.2–22.2 mmol/L (40–400 mg/dL). */
const BELOW_RANGE_MMOL = 2.2;
const ABOVE_RANGE_MMOL = 22.2;
const BELOW_RANGE_WORDS = new Set(["low", "lav"]);
const ABOVE_RANGE_WORDS = new Set(["high", "høj", "hoj"]);

type Unit = "mmol" | "mgdl";

interface Layout {
  delimiter: string;
  columns: Record<keyof typeof COLUMNS, number>;
  unit: Unit;
}

const firstLine = (text: string): string => text.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0] ?? "";

/** A header cell or event type as compared: no BOM, no surrounding quotes, NFC, lower case. */
const keyOf = (text: string | undefined): string =>
  (text ?? "")
    .replace(/^\uFEFF/, "")
    .trim()
    .replace(/^"(.*)"$/, "$1")
    .trim()
    .normalize("NFC")
    .toLowerCase();

function layoutOf(header: string[], delimiter: string): Layout | null {
  const lower = header.map(keyOf);
  const index = (starts: readonly string[]) =>
    lower.findIndex((h) => starts.some((start) => h.startsWith(start)));
  const columns = {
    timestamp: index(COLUMNS.timestamp),
    type: index(COLUMNS.type),
    subtype: index(COLUMNS.subtype),
    glucose: index(COLUMNS.glucose),
    carbs: index(COLUMNS.carbs),
    rate: index(COLUMNS.rate),
  };
  if (columns.timestamp < 0 || columns.type < 0 || columns.glucose < 0) return null;
  const glucoseHeader = lower[columns.glucose] ?? "";
  const unit: Unit | null = glucoseHeader.includes("mmol")
    ? "mmol"
    : glucoseHeader.includes("mg")
      ? "mgdl"
      : null;
  if (!unit) return null;
  return { delimiter, columns, unit };
}

/** A number as Clarity writes it, with a comma decimal in some locales; null for anything else. */
function numberOf(text: string | undefined): number | null {
  if (text === undefined) return null;
  const cleaned = text.trim().replace(/\s/g, "").replace(",", ".");
  if (cleaned === "") return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function mmolOf(text: string | undefined, unit: Unit): number | null {
  const word = keyOf(text);
  if (BELOW_RANGE_WORDS.has(word)) return BELOW_RANGE_MMOL;
  if (ABOVE_RANGE_WORDS.has(word)) return ABOVE_RANGE_MMOL;
  const value = numberOf(text);
  if (value === null) return null;
  return unit === "mgdl" ? mgdlToMmol(value) : Math.round(value * 10) / 10;
}

function rateOf(text: string | undefined, unit: Unit): number | null {
  const value = numberOf(text);
  if (value === null) return null;
  return unit === "mgdl" ? value / MGDL_PER_MMOL : value;
}

function rowsOf(text: string, delimiter: string): string[][] {
  try {
    const parsed: unknown = parse(text, {
      bom: true,
      delimiter,
      relax_column_count: true,
      relax_quotes: true,
      skip_empty_lines: true,
      trim: true,
    });
    if (!Array.isArray(parsed)) return [];
    return parsed.map((row: unknown) =>
      Array.isArray(row) ? row.map((cell: unknown) => (typeof cell === "string" ? cell : "")) : [],
    );
  } catch {
    throw new GlucoseImportError("import-unrecognised");
  }
}

export const clarityImport: GlucoseImportSource = {
  format: "clarity",

  detect(text) {
    const header = firstLine(text);
    const delimiter = header.includes(";") ? ";" : ",";
    return layoutOf(header.split(delimiter), delimiter) !== null;
  },

  parse(text, options: GlucoseImportOptions): GlucoseImportParse {
    const header = firstLine(text);
    const delimiter = header.includes(";") ? ";" : ",";
    const rows = rowsOf(text, delimiter);
    const layout = layoutOf(rows[0] ?? [], delimiter);
    if (!layout) throw new GlucoseImportError("import-unrecognised");
    const { columns, unit } = layout;

    const byInstant = new Map<number, Reading>();
    const carbs: ImportedCarbs[] = [];
    let otherRows = 0;

    for (const row of rows.slice(1)) {
      const type = keyOf(row[columns.type]);
      if (EVENT_TYPES.reading.has(type)) {
        const ts = localToUtc(row[columns.timestamp] ?? "", options.timezone);
        const mmol = mmolOf(row[columns.glucose], unit);
        if (!ts || mmol === null) {
          otherRows += 1;
          continue;
        }
        const rate = columns.rate >= 0 ? rateOf(row[columns.rate], unit) : null;
        const reading = Reading.safeParse({
          ts: ts.toISOString(),
          mmol,
          trend: trendFromRate(rate),
        });
        if (!reading.success) {
          otherRows += 1;
          continue;
        }
        // The first row for an instant wins; an export never carries two readings for one time.
        if (!byInstant.has(ts.getTime())) byInstant.set(ts.getTime(), reading.data);
        continue;
      }
      if (EVENT_TYPES.carbs.has(type)) {
        const ts = localToUtc(row[columns.timestamp] ?? "", options.timezone);
        const grams = columns.carbs >= 0 ? numberOf(row[columns.carbs]) : null;
        if (!ts || grams === null || grams <= 0) {
          otherRows += 1;
          continue;
        }
        carbs.push({ ts: ts.toISOString(), grams: Math.round(grams) });
        continue;
      }
      // Patient, device and alert rows, calibrations, exercise, health and the dosing rows: the
      // type is all that was read of them.
      otherRows += 1;
    }

    const readings = [...byInstant.entries()].sort((a, b) => a[0] - b[0]).map(([, r]) => r);
    carbs.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
    if (readings.length === 0 && carbs.length === 0) throw new GlucoseImportError("import-empty");
    return { format: "clarity", readings, carbs, otherRows };
  },
};

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
 * Event types: `EGV` is a reading (`Low`/`High` for a value past the sensor's range); `Carbs` is
 * a carb entry from the Dexcom app. Every other type (calibrations, exercise, health, alerts,
 * the patient rows and the dosing rows) is counted and otherwise left unread. Timestamps are
 * wall-clock times without an offset; the space's timezone places them.
 */
const COLUMNS = {
  timestamp: "timestamp",
  type: "event type",
  subtype: "event subtype",
  glucose: "glucose value",
  carbs: "carb value",
  rate: "glucose rate of change",
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

function layoutOf(header: string[], delimiter: string): Layout | null {
  const lower = header.map((h) => h.trim().toLowerCase());
  const index = (prefix: string) => lower.findIndex((h) => h.startsWith(prefix));
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
  const word = (text ?? "").trim().toLowerCase();
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
      const type = (row[columns.type] ?? "").trim().toLowerCase();
      if (type === "egv") {
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
      if (type === "carbs") {
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

import type { ApiErrorCode } from "../../schemas/api";
import type { GlucoseImportFormat, Reading } from "../../schemas/glucose";

/** A carb entry from the export, as the Dexcom app logged it; it becomes an unverified meal. */
export interface ImportedCarbs {
  ts: string;
  grams: number;
}

/**
 * What an export parses to. Readings and carbs only: nothing else in the file has a place here.
 * Rows of any other kind, insulin rows included, are counted in `otherRows` and never read beyond
 * their type. The import is not the pump-history path (CLAUDE.md hard rules): what the pump
 * delivered reaches Frejsi only through a `PumpSource`, read-only, in `shared/src/pump/`.
 */
export interface GlucoseImportParse {
  format: GlucoseImportFormat;
  /** Oldest first, one per instant, each with its `ts` in UTC. */
  readings: Reading[];
  carbs: ImportedCarbs[];
  otherRows: number;
}

export interface GlucoseImportOptions {
  /** The IANA timezone the export's wall-clock times are in: the space's. */
  timezone: string;
}

/**
 * One export format (spec §3's plugin shape for files rather than services): Clarity today;
 * LibreView, Nightscout dumps and others add a file here and a name to `GlucoseImportFormat`,
 * nothing elsewhere.
 */
export interface GlucoseImportSource {
  readonly format: GlucoseImportFormat;
  /** True when the text looks like this format's export; cheap, no full parse. */
  detect(text: string): boolean;
  /** Throws `GlucoseImportError` for a file this format cannot read. */
  parse(text: string, options: GlucoseImportOptions): GlucoseImportParse;
}

/** A refusal the route turns into a 400 with its code; the message is the code, never file contents. */
export class GlucoseImportError extends Error {
  constructor(readonly code: Extract<ApiErrorCode, "import-unrecognised" | "import-empty">) {
    super(code);
    this.name = "GlucoseImportError";
  }
}

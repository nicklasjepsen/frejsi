import { clarityImport } from "./clarity";
import {
  GlucoseImportError,
  type GlucoseImportOptions,
  type GlucoseImportParse,
  type GlucoseImportSource,
} from "./types";

/** Every export format Frejsi reads, tried in order; a fork adds its own here. */
export const GLUCOSE_IMPORT_SOURCES: readonly GlucoseImportSource[] = [clarityImport];

/** The first format that recognises the text parses it; none recognising it is `import-unrecognised`. */
export function parseGlucoseImport(
  text: string,
  options: GlucoseImportOptions,
  sources: readonly GlucoseImportSource[] = GLUCOSE_IMPORT_SOURCES,
): GlucoseImportParse {
  const source = sources.find((s) => s.detect(text));
  if (!source) throw new GlucoseImportError("import-unrecognised");
  return source.parse(text, options);
}
